import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationService } from './notification.service';
import {
  NotificationFeedQueryDto,
  NotificationFeedResponseDto,
} from './dto/notification-feed-query.dto';
import { Notification } from './notification.entity';

interface RequestWithUser extends Request {
  user: { id: string };
}

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get notification feed with cursor pagination and filters' })
  async list(
    @Req() req: RequestWithUser,
    @Query() query: NotificationFeedQueryDto,
  ): Promise<NotificationFeedResponseDto<Notification>> {
    return this.notificationService.findFeed(req.user.id, query);
  }
}
