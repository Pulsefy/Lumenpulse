import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserPreferences } from '../entities/user.entity';

export class ProfileResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'User email address' })
  email: string;

  @ApiPropertyOptional({ description: 'First name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  lastName?: string;

  @ApiPropertyOptional({ description: 'Display name shown in the UI' })
  displayName?: string;

  @ApiPropertyOptional({ description: 'User bio/description' })
  bio?: string;

  @ApiPropertyOptional({ description: 'URL to user avatar image' })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Primary linked Stellar public key' })
  stellarPublicKey?: string;

  @ApiPropertyOptional({ description: 'User notification/currency preferences' })
  preferences?: UserPreferences;

  @ApiProperty({ description: 'When the user account was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the user account was last updated' })
  updatedAt: Date;

  constructor(partial: Partial<ProfileResponseDto>) {
    Object.assign(this, partial);
  }
}
