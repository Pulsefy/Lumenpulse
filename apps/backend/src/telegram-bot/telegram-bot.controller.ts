import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramAlertType } from './telegram-subscription.entity';

class SendAlertDto {
  @ApiProperty({
    description: 'Type of alert',
    enum: TelegramAlertType,
    example: TelegramAlertType.PRICE,
  })
  alertType: TelegramAlertType;

  @ApiProperty({
    description: 'The text message to broadcast',
    example: 'BTC price has broken $100k!',
  })
  message: string;
}

@ApiTags('telegram-bot')
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
  @ApiOperation({
    summary: 'Broadcast alert to Telegram subscribers',
    description:
      'Broadcasts a price, news, or security alert to all active chats subscribed to that category.',
  })
  @ApiResponse({
    status: 200,
    description: 'Broadcast completed successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Broadcast sent' },
      },
    },
  })
  async broadcast(@Body() dto: SendAlertDto) {
    await this.telegramBotService.broadcastAlert(dto.alertType, dto.message);
    return { success: true, message: 'Broadcast sent' };
  }
}
