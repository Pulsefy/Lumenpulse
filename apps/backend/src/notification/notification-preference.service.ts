import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreference,
  NotificationChannel,
} from './notification-preference.entity';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
} from './dto/notification-preference.dto';

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  /**
   * Create or update notification preferences for a user
   */
  async createOrUpdate(
    dto: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    // Check if preferences already exist
    const preference = await this.preferenceRepository.findOne({
      where: { userId: dto.userId },
    });

    if (preference) {
      // Update existing
      const updateDto: UpdateNotificationPreferenceDto = {
        enabledChannels: dto.enabledChannels,
        eventPreferences: dto.eventPreferences,
        quietHours: dto.quietHours,
        dailyLimit: dto.dailyLimit,
        minSeverity: dto.minSeverity,
      };
      return this.update(preference.id, updateDto);
    }

    // Create new
    const newPreference = this.preferenceRepository.create({
      userId: dto.userId,
      enabledChannels: dto.enabledChannels ?? [NotificationChannel.IN_APP],
      eventPreferences: dto.eventPreferences ?? {},
      quietHours: dto.quietHours ?? null,
      dailyLimit: dto.dailyLimit ?? 0,
      minSeverity: dto.minSeverity ?? 'low',
    });

    const saved = await this.preferenceRepository.save(newPreference);
    this.logger.log(`Created notification preferences for user ${dto.userId}`);
    return saved;
  }

  /**
   * Get notification preferences for a user
   */
  async findByUserId(userId: string): Promise<NotificationPreference> {
    const preference = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (!preference) {
      throw new NotFoundException(
        `Notification preferences not found for user ${userId}`,
      );
    }

    return preference;
  }

  /**
   * Update notification preferences
   */
  async update(
    id: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    const preference = await this.preferenceRepository.findOne({
      where: { id },
    });

    if (!preference) {
      throw new NotFoundException(
        `Notification preference with ID ${id} not found`,
      );
    }

    // Update fields
    if (dto.enabledChannels !== undefined) {
      preference.enabledChannels = dto.enabledChannels;
    }

    if (dto.eventPreferences !== undefined) {
      preference.eventPreferences = dto.eventPreferences;
    }

    if (dto.quietHours !== undefined) {
      preference.quietHours = dto.quietHours;
    }

    if (dto.dailyLimit !== undefined) {
      preference.dailyLimit = dto.dailyLimit;
    }

    if (dto.minSeverity !== undefined) {
      preference.minSeverity = dto.minSeverity;
    }

    const updated = await this.preferenceRepository.save(preference);
    this.logger.log(`Updated notification preferences ${id}`);
    return updated;
  }

  /**
   * Delete notification preferences (user will use defaults)
   */
  async remove(id: string): Promise<void> {
    const result = await this.preferenceRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(
        `Notification preference with ID ${id} not found`,
      );
    }
    this.logger.log(`Deleted notification preferences ${id}`);
  }

  /**
   * Get enabled channels for a specific event category and user
   */
  async getEnabledChannelsForEvent(
    userId: string,
    eventCategory: string,
  ): Promise<NotificationChannel[]> {
    const preference = await this.findByUserId(userId);

    // Check if event category is enabled
    const eventPref = preference.eventPreferences[eventCategory];

    if (eventPref && !eventPref.enabled) {
      return [];
    }

    // Use event-specific channels if defined, otherwise use global channels
    const channels = (eventPref?.channels ?? preference.enabledChannels) || [];

    return channels;
  }

  /**
   * Check if a notification should be delivered during quiet hours
   */
  isWithinQuietHours(
    preference: NotificationPreference,
    severity: string,
  ): boolean {
    if (!preference.quietHours) {
      return false;
    }

    const { startHour, endHour, allowCritical } = preference.quietHours;
    const currentHour = new Date().getUTCHours();

    // Check if current time is within quiet hours
    let isQuiet = false;
    if (startHour <= endHour) {
      isQuiet = currentHour >= startHour && currentHour < endHour;
    } else {
      // Handles case like 22:00 to 06:00 (overnight)
      isQuiet = currentHour >= startHour || currentHour < endHour;
    }

    if (!isQuiet) {
      return false;
    }

    // Allow critical notifications even during quiet hours
    if (allowCritical && severity === 'critical') {
      return false;
    }

    return true;
  }

  /**
   * Check if notification meets minimum severity threshold
   */
  meetsSeverityThreshold(
    preference: NotificationPreference,
    severity: string,
    eventCategory?: string,
  ): boolean {
    // Get effective minimum severity (event-specific or global)
    let minSeverity = preference.minSeverity;
    if (
      eventCategory &&
      preference.eventPreferences[eventCategory]?.minSeverity
    ) {
      minSeverity = preference.eventPreferences[eventCategory].minSeverity!;
    }

    const severityLevels = ['low', 'medium', 'high', 'critical'];
    const minIndex = severityLevels.indexOf(minSeverity);
    const notificationIndex = severityLevels.indexOf(severity);

    return notificationIndex >= minIndex;
  }

  /**
   * Check if user has reached their daily notification limit
   */
  async hasReachedDailyLimit(userId: string): Promise<boolean> {
    const preference = await this.findByUserId(userId);

    if (preference.dailyLimit === 0) {
      return false; // Unlimited
    }

    // Count notifications delivered today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // This would require access to notification repository
    // For now, return false (implementation would need to query notifications)
    return false;
  }
}
