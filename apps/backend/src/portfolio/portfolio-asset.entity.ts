// src/portfolio/portfolio-asset.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('portfolio_assets')
export class PortfolioAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  assetCode: string; // e.g. XLM

  @Column({ nullable: true })
  assetIssuer: string;

  @Column('decimal', { precision: 18, scale: 8 })
  amount: string;

  @ManyToOne(() => User, (user) => user.portfolioAssets, {
    onDelete: 'CASCADE',
  })

  @JoinColumn({ name: 'userId' })
  user: User;

}