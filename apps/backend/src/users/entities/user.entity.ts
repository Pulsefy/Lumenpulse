import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { StellarAccount } from './stellar-account.entity';

export enum UserRole {
  USER = 'user',
  REVIEWER = 'reviewer',
  ADMIN = 'admin',
}

export interface NotificationPreferences {
  priceAlerts: boolean;
  newsAlerts: boolean;
  securityAlerts: boolean;
}

export interface UserPreferences {
  notifications: NotificationPreferences;
  preferredCurrency?: 'USD' | 'EUR' | 'GBP' | 'NGN' | 'XLM';
}

@Entity('users')
@Index(['role'])
@Index(['createdAt'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  firstName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  stellarPublicKey: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({
    type: 'jsonb',
    default: {
      notifications: {
        priceAlerts: true,
        newsAlerts: true,
        securityAlerts: true,
      },
      preferredCurrency: 'USD',
    },
  })
  preferences: UserPreferences;

  @Column({ type: 'boolean', default: false })
  twoFactorEnabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  twoFactorSecret: string | null;

  @OneToMany(() => StellarAccount, (stellarAccount) => stellarAccount.user)
  stellarAccounts: StellarAccount[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
