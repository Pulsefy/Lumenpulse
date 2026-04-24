import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getUserNotifications(@Req() req: AuthenticatedRequest) {
    const notifications = await this.notificationsService.getUserNotifications(
      req.user.userId,
    );
    return notifications.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.read,
      createdAt: n.createdAt,
    }));
  }

  @Get('unread-count')
  async getUnreadCount(@Req() req: AuthenticatedRequest) {
    const count = await this.notificationsService.getUnreadCount(req.user.userId);
    return { unreadCount: count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const notification = await this.notificationsService.markAsRead(
      parseInt(id, 10),
      req.user.userId,
    );
    return {
      id: notification.id,
      read: notification.read,
    };
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@Req() req: AuthenticatedRequest) {
    await this.notificationsService.markAllAsRead(req.user.userId);
    return { success: true };
  }
}
