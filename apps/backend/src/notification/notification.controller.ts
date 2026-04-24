import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationService } from './notification.service';
import { PushNotificationService } from './push-notification.service';
import {
  RegisterDeviceDto,
  SendPushNotificationDto,
  PushTokenResponseDto,
  DeepLinkDataDto,
} from './dto/deep-link.dto';
import { getAuthThrottleOverride } from '../common/rate-limit/rate-limit.config';

@ApiTags('notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  @Post('devices/register')
  @Throttle(getAuthThrottleOverride())
  @ApiOperation({
    summary: 'Register device push token',
    description: 'Register a push notification token for the authenticated user\'s device',
  })
  @ApiResponse({ status: 201, description: 'Token registered successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @Request() req: any,
    @Body() dto: RegisterDeviceDto,
  ): Promise<PushTokenResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    const token = await this.pushNotificationService.registerToken(
      userId,
      dto.token,
      dto.platform,
      dto.deviceName,
    );
    return {
      id: token.id,
      token: token.token,
      platform: token.platform,
      deviceName: token.deviceName,
      isActive: token.isActive,
      createdAt: token.createdAt,
    };
  }

  @Post('devices/unregister')
  @Throttle(getAuthThrottleOverride())
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister device push token',
    description: 'Deactivate a push notification token for the authenticated user',
  })
  @ApiResponse({ status: 204, description: 'Token unregistered successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unregisterDevice(
    @Request() req: any,
    @Body() body: { token: string },
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    await this.pushNotificationService.unregisterToken(userId, body.token);
  }

  @Get('devices')
  @Throttle(getAuthThrottleOverride())
  @ApiOperation({
    summary: 'Get registered devices',
    description: 'List all active push notification tokens for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of registered devices',
    type: [PushTokenResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDevices(@Request() req: any): Promise<PushTokenResponseDto[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    const tokens = await this.pushNotificationService.getActiveTokensForUser(
      userId,
    );
    return tokens.map((token) => ({
      id: token.id,
      token: token.token,
      platform: token.platform,
      deviceName: token.deviceName,
      isActive: token.isActive,
      createdAt: token.createdAt,
    }));
  }

  @Post('send')
  @Throttle(getAuthThrottleOverride())
  @ApiOperation({
    summary: 'Send push notification',
    description:
      'Send a push notification to the authenticated user\'s registered devices with optional deep link',
  })
  @ApiResponse({ status: 200, description: 'Notification sent' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendPush(
    @Request() req: any,
    @Body() dto: SendPushNotificationDto,
  ): Promise<{ success: number; failed: number }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.pushNotificationService.sendToUser(
      userId,
      dto.title,
      dto.body,
      dto.deepLink,
      dto.data,
    );
  }

  @Get()
  @Throttle(getAuthThrottleOverride())
  @ApiOperation({
    summary: 'Get user notifications',
    description: 'Get all notifications for the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Notifications retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNotifications(@Request() req: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.notificationService.findForUser(userId);
  }
}
