// src/users/user.entity.ts
import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity'; // adjust path if needed

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  // Optional: One-to-Many relation to PortfolioAsset
  @OneToMany(() => PortfolioAsset, asset => asset.user)
  portfolioAssets: PortfolioAsset[];
}
