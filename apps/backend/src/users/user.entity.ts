import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  displayName?: string;

  @Column({ nullable: true })
  bio?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column()
  passwordHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  // Optional: One-to-Many relation to PortfolioAsset
  @OneToMany(() => PortfolioAsset, (asset) => asset.user)

  @OneToMany(
    () => PortfolioAsset,
    (asset: PortfolioAsset) => asset.user,
  )
  portfolioAssets: PortfolioAsset[];
}
