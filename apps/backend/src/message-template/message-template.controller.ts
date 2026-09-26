import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { MessageTemplateService } from './message-template.service';
import {
  MessageTemplateAuditLogResponseDto,
  MessageTemplateResponseDto,
  PreviewMessageTemplateDto,
  RenderedMessageTemplateDto,
  UpdateMessageTemplateDto,
} from './dto/message-template.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { JWT_SECURITY_SCHEME } from '../openapi/openapi.constants';

type AuthenticatedRequest = Request & {
  user?: { email?: string; id?: string };
};

@ApiTags('message-templates')
@ApiBearerAuth(JWT_SECURITY_SCHEME)
@Controller('message-templates')
export class MessageTemplateController {
  constructor(
    private readonly messageTemplateService: MessageTemplateService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List message templates (admin)' })
  @ApiResponse({ status: 200, type: [MessageTemplateResponseDto] })
  async list(): Promise<MessageTemplateResponseDto[]> {
    const templates = await this.messageTemplateService.listTemplates();
    return templates.map((t) => this.toResponse(t));
  }

  @Get(':key/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get template change history (admin)' })
  @ApiResponse({ status: 200, type: [MessageTemplateAuditLogResponseDto] })
  async history(
    @Param('key') key: string,
  ): Promise<MessageTemplateAuditLogResponseDto[]> {
    return this.messageTemplateService.getTemplateHistory(key);
  }

  @Post(':key/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a template with sample or custom variables (admin)',
  })
  @ApiResponse({ status: 200, type: RenderedMessageTemplateDto })
  async preview(
    @Param('key') key: string,
    @Body() dto: PreviewMessageTemplateDto,
  ): Promise<RenderedMessageTemplateDto> {
    return this.messageTemplateService.preview(key, dto.variables);
  }

  @Put(':key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a message template (admin)' })
  @ApiResponse({ status: 200, type: MessageTemplateResponseDto })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateMessageTemplateDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MessageTemplateResponseDto> {
    const actor = req.user?.email ?? req.user?.id ?? null;
    const updated = await this.messageTemplateService.updateTemplate(
      key,
      dto,
      actor ?? undefined,
    );
    return this.toResponse(updated);
  }

  private toResponse(template: {
    key: string;
    version: number;
    subjectTemplate: string | null;
    titleTemplate: string | null;
    messageTemplate: string | null;
    bodyTemplate: string | null;
    requiredVariables: string[];
    sampleVariables: Record<string, string>;
    updatedAt: Date;
  }): MessageTemplateResponseDto {
    return {
      key: template.key,
      version: template.version,
      subjectTemplate: template.subjectTemplate,
      titleTemplate: template.titleTemplate,
      messageTemplate: template.messageTemplate,
      bodyTemplate: template.bodyTemplate,
      requiredVariables: template.requiredVariables,
      sampleVariables: template.sampleVariables,
      updatedAt: template.updatedAt,
    };
  }
}
