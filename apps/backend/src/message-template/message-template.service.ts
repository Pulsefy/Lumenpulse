import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplate } from './message-template.entity';
import { MessageTemplateAuditLog } from './message-template-audit-log.entity';
import { MESSAGE_TEMPLATE_DEFAULTS } from './message-template.defaults';
import { renderTemplateField } from './message-template-renderer';
import { MessageTemplateRenderError } from './message-template.errors';
import { UpdateMessageTemplateDto } from './dto/message-template.dto';

export interface RenderedMessageTemplate {
  templateKey: string;
  version: number;
  subject?: string;
  title?: string;
  message?: string;
  body?: string;
}

@Injectable()
export class MessageTemplateService {
  private readonly logger = new Logger(MessageTemplateService.name);

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,
    @InjectRepository(MessageTemplateAuditLog)
    private readonly auditRepository: Repository<MessageTemplateAuditLog>,
  ) {}

  async listTemplates(): Promise<MessageTemplate[]> {
    return this.templateRepository.find({ order: { key: 'ASC' } });
  }

  async getTemplate(key: string): Promise<MessageTemplate> {
    const template = await this.templateRepository.findOne({ where: { key } });
    if (!template) {
      throw new NotFoundException(`Message template not found: ${key}`);
    }
    return template;
  }

  async getTemplateHistory(key: string): Promise<MessageTemplateAuditLog[]> {
    return this.auditRepository.find({
      where: { templateKey: key },
      order: { changedAt: 'DESC' },
    });
  }

  async render(
    key: string,
    variables: Record<string, string | number>,
  ): Promise<RenderedMessageTemplate> {
    const template = await this.getTemplate(key);
    return this.renderFromEntity(template, variables);
  }

  async preview(
    key: string,
    variables?: Record<string, string | number>,
  ): Promise<RenderedMessageTemplate> {
    const template = await this.getTemplate(key);
    const resolvedVariables = {
      ...template.sampleVariables,
      ...(variables ?? {}),
    };
    return this.renderFromEntity(template, resolvedVariables);
  }

  async updateTemplate(
    key: string,
    dto: UpdateMessageTemplateDto,
    actor?: string,
  ): Promise<MessageTemplate> {
    const existing = await this.getTemplate(key);
    const previousSnapshot = this.toSnapshot(existing);

    const updated = await this.templateRepository.save({
      ...existing,
      subjectTemplate:
        dto.subjectTemplate !== undefined
          ? dto.subjectTemplate
          : existing.subjectTemplate,
      titleTemplate:
        dto.titleTemplate !== undefined
          ? dto.titleTemplate
          : existing.titleTemplate,
      messageTemplate:
        dto.messageTemplate !== undefined
          ? dto.messageTemplate
          : existing.messageTemplate,
      bodyTemplate:
        dto.bodyTemplate !== undefined
          ? dto.bodyTemplate
          : existing.bodyTemplate,
      requiredVariables:
        dto.requiredVariables !== undefined
          ? dto.requiredVariables
          : existing.requiredVariables,
      sampleVariables:
        dto.sampleVariables !== undefined
          ? dto.sampleVariables
          : existing.sampleVariables,
      version: existing.version + 1,
      updatedBy: actor ?? null,
    });

    const auditEntry = this.auditRepository.create({
      templateKey: key,
      action: 'update',
      previousVersion: existing.version,
      newVersion: updated.version,
      previousSnapshot,
      newSnapshot: this.toSnapshot(updated),
      actor: actor ?? null,
    });
    await this.auditRepository.save(auditEntry);

    this.logger.log(
      `Message template "${key}" updated to v${updated.version}` +
        (actor ? ` by ${actor}` : ''),
    );

    return updated;
  }

  private renderFromEntity(
    template: MessageTemplate,
    variables: Record<string, string | number>,
  ): RenderedMessageTemplate {
    for (const name of template.requiredVariables) {
      if (!(name in variables)) {
        throw new MessageTemplateRenderError(
          `Missing required variable "${name}" for template "${template.key}"`,
          'MISSING_VARIABLE',
          { templateKey: template.key, variable: name },
        );
      }
    }

    const result: RenderedMessageTemplate = {
      templateKey: template.key,
      version: template.version,
    };

    if (template.subjectTemplate) {
      result.subject = renderTemplateField(
        template.subjectTemplate,
        variables,
        [],
        `${template.key} subject`,
      ).rendered;
    }

    if (template.titleTemplate) {
      result.title = renderTemplateField(
        template.titleTemplate,
        variables,
        [],
        `${template.key} title`,
      ).rendered;
    }

    if (template.messageTemplate) {
      result.message = renderTemplateField(
        template.messageTemplate,
        variables,
        [],
        `${template.key} message`,
      ).rendered;
    }

    if (template.bodyTemplate) {
      result.body = renderTemplateField(
        template.bodyTemplate,
        variables,
        [],
        `${template.key} body`,
      ).rendered;
    }

    return result;
  }

  private toSnapshot(template: MessageTemplate): Record<string, unknown> {
    return {
      subjectTemplate: template.subjectTemplate,
      titleTemplate: template.titleTemplate,
      messageTemplate: template.messageTemplate,
      bodyTemplate: template.bodyTemplate,
      requiredVariables: template.requiredVariables,
      sampleVariables: template.sampleVariables,
      version: template.version,
    };
  }

  /** Used by migration seeding and tests. */
  static defaultDefinitions() {
    return MESSAGE_TEMPLATE_DEFAULTS;
  }
}
