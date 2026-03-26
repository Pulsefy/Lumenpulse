import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('stellar_accounts')
@Index(['userId', 'publicKey'], { unique: true })
export class StellarAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.stellarAccounts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 56 })
  publicKey: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

// import {
//   Entity,
//   PrimaryGeneratedColumn,
//   Column,
//   ManyToOne,
//   JoinColumn,
//   CreateDateColumn,
//   UpdateDateColumn,
//   Index,
// } from 'typeorm';
// import { User } from './user.entity';

// @Entity('stellar_accounts')
// @Index(['userId', 'publicKey'], { unique: true })
// export class StellarAccount {
//   @PrimaryGeneratedColumn('uuid')
//   id: string;

//   @Column({ type: 'uuid' })
//   userId: string;

//   @ManyToOne(() => User, user => user.stellarAccounts, { onDelete: 'CASCADE' })
//   @JoinColumn({ name: 'userId' })
//   user: User;

//   @Index({ unique: true })
//   @Column({ type: 'varchar', length: 56 })
//   publicKey: string;

//   @Column({ type: 'varchar', length: 100, nullable: true })
//   label: string;

//   @Column({ type: 'boolean', default: true })
//   isActive: boolean;

//   @CreateDateColumn({ type: 'timestamptz' })
//   createdAt: Date;

//   @UpdateDateColumn({ type: 'timestamptz' })
//   updatedAt: Date;
// }
