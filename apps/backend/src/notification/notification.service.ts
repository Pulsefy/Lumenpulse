import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Notification,
  NotificationType,
  NotificationSeverity,
} from './notification.entity';

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
}
