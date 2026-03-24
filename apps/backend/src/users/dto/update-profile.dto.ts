import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: 'Enable price alert notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  priceAlerts?: boolean;

  @ApiPropertyOptional({
    description: 'Enable news alert notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  newsAlerts?: boolean;

  @ApiPropertyOptional({
    description: 'Enable security alert notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  securityAlerts?: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description: 'Notification preference set',
    type: UpdateNotificationPreferencesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateNotificationPreferencesDto)
  notifications?: UpdateNotificationPreferencesDto;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Display name for user',
    example: 'John Doe',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'User bio/description',
    example: 'Software developer passionate about blockchain technology',
  })
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({
    description: 'URL to user avatar image',
    example: 'https://example.com/avatar.jpg',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'User preference updates',
    type: UpdatePreferencesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePreferencesDto)
  preferences?: UpdatePreferencesDto;
}
