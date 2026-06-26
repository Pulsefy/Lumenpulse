import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceResponseDto,
} from './dto/notification-preference.dto';
import { NotificationPreference } from './notification-preference.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('notification-preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notification-preferences')
export class NotificationPreferenceController {
  constructor(
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create or update notification preferences',
    description:
      'Creates or updates notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: 201,
    description: 'Preferences created/updated successfully',
    type: NotificationPreferenceResponseDto,
  })
  async createOrUpdate(
    @Body() dto: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    return this.preferenceService.createOrUpdate(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get notification preferences',
    description:
      'Retrieves notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User notification preferences',
    type: NotificationPreferenceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Preferences not found' })
  async getPreferences(
    @Param('userId') userId: string,
  ): Promise<NotificationPreference> {
    return this.preferenceService.findByUserId(userId);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get notification preferences by user ID',
    description:
      'Retrieves notification preferences for a specific user (admin only)',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User notification preferences',
    type: NotificationPreferenceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Preferences not found' })
  async getPreferencesByUserId(
    @Param('userId') userId: string,
  ): Promise<NotificationPreference> {
    return this.preferenceService.findByUserId(userId);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update notification preferences',
    description: 'Updates notification preferences by ID',
  })
  @ApiParam({ name: 'id', description: 'Preference ID' })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
    type: NotificationPreferenceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Preferences not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    return this.preferenceService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete notification preferences',
    description: 'Deletes notification preferences (user will use defaults)',
  })
  @ApiParam({ name: 'id', description: 'Preference ID' })
  @ApiResponse({ status: 204, description: 'Preferences deleted' })
  @ApiResponse({ status: 404, description: 'Preferences not found' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.preferenceService.remove(id);
  }

  @Get(':userId/channels/:eventCategory')
  @ApiOperation({
    summary: 'Get enabled channels for an event category',
    description:
      'Returns the enabled notification channels for a specific event category',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiParam({
    name: 'eventCategory',
    description: 'Event category',
    enum: ['anomaly', 'sentiment_spike', 'system_alert', 'price_threshold'],
  })
  @ApiResponse({
    status: 200,
    description: 'List of enabled channels',
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: ['in_app', 'email'],
    },
  })
  async getEnabledChannelsForEvent(
    @Param('userId') userId: string,
    @Param('eventCategory') eventCategory: string,
  ): Promise<string[]> {
    return this.preferenceService.getEnabledChannelsForEvent(
      userId,
      eventCategory,
    );
  }
}
