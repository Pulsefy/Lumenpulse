import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplateService } from './message-template.service';
import { MessageTemplate } from './message-template.entity';
import { MessageTemplateAuditLog } from './message-template-audit-log.entity';
import { MessageTemplateKey } from './message-template.keys';
import { MESSAGE_TEMPLATE_DEFAULTS } from './message-template.defaults';
import { NotFoundException } from '@nestjs/common';

describe('MessageTemplateService', () => {
  let service: MessageTemplateService;
  let templateRepo: jest.Mocked<Repository<MessageTemplate>>;
  let auditRepo: jest.Mocked<Repository<MessageTemplateAuditLog>>;

  const priceAlertDef = MESSAGE_TEMPLATE_DEFAULTS.find(
    (d) => d.key === MessageTemplateKey.NOTIFICATION_PRICE_ALERT,
  )!;

  const seededTemplate: MessageTemplate = {
    id: 'tpl-1',
    key: priceAlertDef.key,
    version: 1,
    subjectTemplate: priceAlertDef.subjectTemplate,
    titleTemplate: priceAlertDef.titleTemplate,
    messageTemplate: priceAlertDef.messageTemplate,
    bodyTemplate: priceAlertDef.bodyTemplate,
    requiredVariables: priceAlertDef.requiredVariables,
    sampleVariables: priceAlertDef.sampleVariables,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    templateRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<MessageTemplate>>;

    auditRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<MessageTemplateAuditLog>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageTemplateService,
        {
          provide: getRepositoryToken(MessageTemplate),
          useValue: templateRepo,
        },
        {
          provide: getRepositoryToken(MessageTemplateAuditLog),
          useValue: auditRepo,
        },
      ],
    }).compile();

    service = module.get(MessageTemplateService);
  });

  it('renders a stored template', async () => {
    templateRepo.findOne.mockResolvedValue(seededTemplate);

    const rendered = await service.render(MessageTemplateKey.NOTIFICATION_PRICE_ALERT, {
      symbol: 'XLM',
      directionPhrase: 'risen above',
      targetPrice: 0.15,
      currentPrice: 0.16,
    });

    expect(rendered.title).toBe('Price Alert: XLM');
    expect(rendered.message).toContain('risen above');
  });

  it('throws when template is missing', async () => {
    templateRepo.findOne.mockResolvedValue(null);
    await expect(
      service.render(MessageTemplateKey.NOTIFICATION_PRICE_ALERT, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records audit log on update', async () => {
    templateRepo.findOne.mockResolvedValue(seededTemplate);
    templateRepo.save.mockImplementation(async (entity) => ({
      ...(entity as MessageTemplate),
      version: 2,
    }));

    await service.updateTemplate(
      MessageTemplateKey.NOTIFICATION_PRICE_ALERT,
      { titleTemplate: 'Alert: {{symbol}}' },
      'admin@example.com',
    );

    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: MessageTemplateKey.NOTIFICATION_PRICE_ALERT,
        action: 'update',
        previousVersion: 1,
        newVersion: 2,
        actor: 'admin@example.com',
      }),
    );
  });
});
