import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity'; // adjust path if needed
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @Index()
  stellarPublicKey: string;

  @Column({ nullable: true, unique: true })
  username?: string;

  @Column({ nullable: true, unique: true })
  email?: string;

  @Column({ type: 'jsonb', nullable: true })
  profile?: {
    displayName?: string;
    avatar?: string;
    bio?: string;
  };

  @Column({
    type: 'jsonb',
    default: { theme: 'dark', notifications: { email: true, push: true } },
  })
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    notifications: {
      email: boolean;
      push: boolean;
    };
  };

  @Column({ type: 'jsonb', default: [] })
  portfolio: Array<{
    asset: string;
    amount: number;
    purchasePrice: number;
    purchaseDate: Date;
  }>;

  @Column({ type: 'jsonb', default: { totalEarned: 0 } })
  rewards: {
    totalEarned: number;
    lastClaim?: Date;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin?: Date;

  @Column({ default: true })
  isActive: boolean;

  // Optional: One-to-Many relation to PortfolioAsset
  @OneToMany(() => PortfolioAsset, (asset) => asset.user)
  portfolioAssets: PortfolioAsset[];
}
