import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramAlertType } from './telegram-subscription.entity';

class SendAlertDto {
  alertType: TelegramAlertType;
  message: string;
}

@Controller('telegram-bot')
export class TelegramBotController {
  private readonly logger = new Logger(TelegramBotController.name);

  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Admin endpoint to broadcast an alert to all subscribed chats.
   * In production, this should be protected by admin authentication.
   */
  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  async broadcast(@Body() dto: SendAlertDto) {
    await this.telegramBotService.broadcastAlert(dto.alertType, dto.message);
    return { success: true, message: 'Broadcast sent' };
  }
}
