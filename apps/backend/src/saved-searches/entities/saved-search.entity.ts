import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

/**
 * The domain type a saved search targets.
 * Grants and projects are the primary domains required by the issue;
 * news is the additional domain.
 */
export enum SavedSearchDomain {
  GRANTS = 'grants',
  PROJECTS = 'projects',
  NEWS = 'news',
}

@Entity('saved_searches')
@Index(['userId', 'domain'])
@Index(['userId', 'createdAt'])
@Index(['isSubscribed'])
export class SavedSearch {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the saved search' })
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty({ description: 'ID of the owning user' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 120 })
  @ApiProperty({
    description: 'Human-readable label for this saved search',
    example: 'Stellar DeFi grants – round 4',
  })
  name: string;

  @Column({
    type: 'enum',
    enum: SavedSearchDomain,
    default: SavedSearchDomain.GRANTS,
  })
  @ApiProperty({
    description: 'Domain this search targets',
    enum: SavedSearchDomain,
    example: SavedSearchDomain.GRANTS,
  })
  domain: SavedSearchDomain;

  /**
   * Serialised query parameters exactly as the client would append them to the
   * relevant discovery endpoint.  Stored as JSONB so downstream processors can
   * re-execute the search without re-parsing a query string.
   *
   * Examples:
   *   grants  → { "status": "active", "keyword": "DeFi" }
   *   projects → { "q": "Stellar", "ownerAddress": "G…" }
   *   news     → { "tag": "xlm", "category": "DeFi" }
   */
  @Column({ type: 'jsonb', default: {} })
  @ApiProperty({
    description:
      'Domain-specific filter parameters stored as a JSON object.  ' +
      'These are replayed against the corresponding search endpoint to ' +
      'produce a fresh result set.',
    example: { status: 'active', keyword: 'DeFi' },
  })
  filters: Record<string, unknown>;

  /**
   * When true the search is enrolled in the periodic notification workflow:
   * a background job re-executes the query and fans out a notification if new
   * results appear since lastNotifiedAt.
   */
  @Column({ type: 'boolean', default: false })
  @ApiProperty({
    description:
      'Whether the user wants to receive notifications when new results match this search.',
    example: false,
  })
  isSubscribed: boolean;

  /**
   * Timestamp of the last successful notification dispatch for this search.
   * Null until the first notification is sent.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({
    description: 'Timestamp of the last notification dispatch for this search.',
    nullable: true,
  })
  lastNotifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
