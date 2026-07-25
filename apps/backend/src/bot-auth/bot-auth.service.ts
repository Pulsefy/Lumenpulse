import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { ActionMapping, BOT_COMMAND_MAPPINGS, BotActionType } from './types';

@Injectable()
export class BotAuthService {
  private readonly logger = new Logger(BotAuthService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validates a bot command, checks permissions, and logs the outcome.
   * Returns true if authorized, false otherwise.
   */
  async authorizeCommand(
    commandStr: string,
    chatId: string,
    username: string | null,
  ): Promise<boolean> {
    const baseCommand = commandStr.split(' ')[0];
    const mapping = BOT_COMMAND_MAPPINGS[baseCommand];

    if (!mapping) {
      this.logger.warn(`Unknown command attempted: ${commandStr} by ${chatId}`);
      await this.auditService.log('UNKNOWN_COMMAND', chatId, null, {
        command: commandStr,
        username,
        actor: 'bot',
      });
      return false;
    }

    const reason = this.getAuthorizationReason(mapping, chatId);
    const isAuthorized = reason === null;

    if (isAuthorized) {
      await this.auditService.log(mapping.actionName, chatId, null, {
        command: commandStr,
        username,
        actor: 'bot',
        type: mapping.type,
        status: 'SUCCESS',
      });
      return true;
    }

    this.logger.warn(`Unauthorized access attempt for ${mapping.actionName} by ${chatId}`);
    await this.auditService.log(mapping.actionName, chatId, null, {
      command: commandStr,
      username,
      actor: 'bot',
      type: mapping.type,
      status: 'DENIED',
      reason,
    });
    return false;
  }

  private getAuthorizationReason(mapping: ActionMapping, chatId: string): string | null {
    if (mapping.requiresAdmin) {
      const adminChatIds = this.getConfiguredChatIds('ADMIN_CHAT_IDS');
      if (!adminChatIds.includes(chatId)) {
        return 'Admin privileges required';
      }
    }

    if (mapping.type === BotActionType.MUTATION) {
      const trustedMutationChatIds = this.getConfiguredChatIds('TRUSTED_MUTATION_CHAT_IDS');
      if (trustedMutationChatIds.length > 0 && !trustedMutationChatIds.includes(chatId)) {
        return 'Trusted chat required for mutation actions';
      }
    }

    return null;
  }

  private getConfiguredChatIds(key: string): string[] {
    return this.configService.get<string>(key)?.split(',').map((value) => value.trim()).filter(Boolean) || [];
  }
}
