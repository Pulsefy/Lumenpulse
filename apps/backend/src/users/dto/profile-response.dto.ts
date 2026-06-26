import { UserPreferences } from '../entities/user.entity';

export class ProfileResponseDto {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  stellarPublicKey?: string;
  preferences?: UserPreferences;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ProfileResponseDto>) {
    Object.assign(this, partial);
  }
}
