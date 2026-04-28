import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Notification,
  NotificationType,
  NotificationSeverity,
} from './notification.entity';
import { NotificationFeedQueryDto } from './dto/notification-feed-query.dto';
import { SortOrder } from '../common/dto/cursor-pagination.dto';

export interface CreateNotificationDto {
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  metadata?: Record<string, unknown>;
  userId?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create({
      type: dto.type,
      title: dto.title,
      message: dto.message,
      severity: dto.severity,
      metadata: dto.metadata ?? null,
      userId: dto.userId ?? null,
      read: false,
    });

    const saved = await this.notificationRepository.save(notification);
    this.logger.log(
      `Notification created: [${saved.severity.toUpperCase()}] ${saved.title}`,
    );
    return saved;
  }

  async findForUser(userId: string): Promise<Notification[]> {
    return this.notificationRepository
      .createQueryBuilder('n')
      .where('n.userId = :userId OR n.userId IS NULL', { userId })
      .orderBy('n.createdAt', 'DESC')
      .take(50)
      .getMany();
  }

  async findFeed(
    userId: string,
    query: NotificationFeedQueryDto = {},
  ): Promise<{
    items: Notification[];
    nextCursor?: string;
    total: number;
    limit: number;
    sortOrder: SortOrder;
  }> {
    const limit = query.limit ?? 20;
    const sortOrder = query.sortOrder ?? SortOrder.DESC;
    const qb = this.notificationRepository
      .createQueryBuilder('n')
      .where('n.userId = :userId OR n.userId IS NULL', { userId });

    if (query.type) qb.andWhere('n.type = :type', { type: query.type });
    if (query.severity) {
      qb.andWhere('n.severity = :severity', { severity: query.severity });
    }
    if (query.cursor) {
      qb.andWhere(
        sortOrder === SortOrder.ASC
          ? 'n.createdAt > :cursor'
          : 'n.createdAt < :cursor',
        { cursor: query.cursor },
      );
    }

    const total = await qb.getCount();
    const items = await qb
      .orderBy('n.createdAt', sortOrder.toUpperCase() as 'ASC' | 'DESC')
      .addOrderBy('n.id', sortOrder.toUpperCase() as 'ASC' | 'DESC')
      .take(limit)
      .getMany();

    const nextCursor =
      items.length > 0 ? items[items.length - 1].createdAt.toISOString() : undefined;

    return { items, nextCursor, total, limit, sortOrder };
  }
}
