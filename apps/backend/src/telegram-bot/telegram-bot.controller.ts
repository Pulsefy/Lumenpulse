import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramAlertType } from './telegram-subscription.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

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
   * Protected by admin authentication.
   */
  @Post('broadcast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Broadcast alert to Telegram subscribers (admin only)',
    description:
      'Broadcasts a price, news, or security alert to all active chats subscribed to that category. Requires admin role.',
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
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async broadcast(@Body() dto: SendAlertDto) {
    await this.telegramBotService.broadcastAlert(dto.alertType, dto.message);
    return { success: true, message: 'Broadcast sent' };
  }
}
