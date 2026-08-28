import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User, UserRole } from '../entities/user.entity';
import type { UserPreferences } from '../entities/user.entity';

/**
 * Admin-facing user representation. Deliberately omits `passwordHash` and
 * `twoFactorSecret` — those must never leave the service layer, even to
 * admin-only endpoints.
 */
export class UserAdminResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiPropertyOptional({ description: 'User email address', nullable: true })
  email: string | null;

  @ApiPropertyOptional({ description: 'First name', nullable: true })
  firstName: string | null;

  @ApiPropertyOptional({ description: 'Last name', nullable: true })
  lastName: string | null;

  @ApiPropertyOptional({ description: 'Display name shown in the UI', nullable: true })
  displayName: string | null;

  @ApiPropertyOptional({ description: 'User bio/description', nullable: true })
  bio: string | null;

  @ApiPropertyOptional({ description: 'URL to user avatar image', nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({
    description: 'Primary linked Stellar public key',
    nullable: true,
  })
  stellarPublicKey: string | null;

  @ApiProperty({ enum: UserRole, description: 'User role' })
  role: UserRole;

  @ApiProperty({ description: 'User notification/currency preferences' })
  preferences: UserPreferences;

  @ApiProperty({ description: 'Whether two-factor authentication is enabled' })
  twoFactorEnabled: boolean;

  @ApiProperty({ description: 'When the user account was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the user account was last updated' })
  updatedAt: Date;

  constructor(user: User) {
    this.id = user.id;
    this.email = user.email;
    this.firstName = user.firstName;
    this.lastName = user.lastName;
    this.displayName = user.displayName;
    this.bio = user.bio;
    this.avatarUrl = user.avatarUrl;
    this.stellarPublicKey = user.stellarPublicKey;
    this.role = user.role;
    this.preferences = user.preferences;
    this.twoFactorEnabled = user.twoFactorEnabled;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
  }
}
