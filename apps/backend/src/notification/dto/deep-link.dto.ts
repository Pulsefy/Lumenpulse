import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';

export enum DeepLinkScreen {
  NEWS_DETAIL = 'news_detail',
  PROJECT_DETAIL = 'project_detail',
  PORTFOLIO = 'portfolio',
  TRANSACTION_DETAIL = 'transaction_detail',
  SETTINGS = 'settings',
  SETTINGS_NOTIFICATIONS = 'settings_notifications',
  NOTIFICATIONS_LIST = 'notifications_list',
  ASSET_DETAIL = 'asset_detail',
  DISCOVER = 'discover',
}

export class DeepLinkDataDto {
  @ApiProperty({
    description: 'Target screen for deep link navigation',
    enum: DeepLinkScreen,
    example: DeepLinkScreen.NEWS_DETAIL,
  })
  @IsEnum(DeepLinkScreen)
  screen: DeepLinkScreen;

  @ApiPropertyOptional({
    description: 'Entity ID (e.g. news article ID, project ID, transaction ID)',
    example: 'abc-123',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    description: 'Additional parameters for the deep link',
    example: { tab: 'overview', highlight: 'price' },
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class SendPushNotificationDto {
  @ApiProperty({
    description: 'Notification title',
    example: 'Price Alert: XLM up 15%',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification body message',
    example: 'Stellar Lumens has increased by 15% in the last hour.',
  })
  @IsString()
  body: string;

  @ApiPropertyOptional({
    description: 'Deep link data for navigation on tap',
    type: DeepLinkDataDto,
  })
  @IsOptional()
  deepLink?: DeepLinkDataDto;

  @ApiPropertyOptional({
    description: 'Additional payload data',
    example: { priority: 'high' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Push notification token from the device',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'Device platform',
    enum: ['ios', 'android', 'web'],
    example: 'android',
  })
  @IsString()
  platform: string;

  @ApiPropertyOptional({
    description: 'Device name or model',
    example: 'iPhone 15 Pro',
  })
  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class PushTokenResponseDto {
  @ApiProperty({ description: 'Token ID' })
  id: string;

  @ApiProperty({ description: 'Push token' })
  token: string;

  @ApiProperty({ description: 'Platform', enum: ['ios', 'android', 'web'] })
  platform: string;

  @ApiPropertyOptional({ description: 'Device name' })
  deviceName: string | null;

  @ApiProperty({ description: 'Whether token is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}
