import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedSearch } from './saved-search.entity';
import { CreateSavedSearchDto } from './create-saved-search.dto';
import { NotificationService } from '../../notification/notification.service';
import { NotificationType, NotificationSeverity } from '../../notification/notification.entity';

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);

  constructor(
    @InjectRepository(SavedSearch)
    private readonly savedSearchRepository: Repository<SavedSearch>,
    private readonly notificationService: NotificationService,
  ) {}

  async create(userId: string, dto: CreateSavedSearchDto): Promise<SavedSearch> {
    const savedSearch = this.savedSearchRepository.create({
      ...dto,
      userId,
      notifyOnNewResults: dto.notifyOnNewResults ?? false,
    });
    
    const result = await this.savedSearchRepository.save(savedSearch);
    this.logger.log(`User ${userId} created saved search: ${result.id}`);
    
    // If notifyOnNewResults is true, this can be hooked into a downstream notification workflow
    if (result.notifyOnNewResults) {
      this.logger.log(`Subscription enabled for search: ${result.id}. Downstream workflow can be triggered.`);
      
      // Trigger a downstream notification workflow for the subscription
      await this.notificationService.create({
        type: NotificationType.SYSTEM,
        title: 'Search Subscription Activated',
        message: `You will now receive updates for your saved search: "${result.name}".`,
        severity: NotificationSeverity.LOW,
        userId: userId,
        metadata: { savedSearchId: result.id, domain: result.domain },
      });
    }

    return result;
  }

  async findAllForUser(userId: string): Promise<SavedSearch[]> {
    return this.savedSearchRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<SavedSearch> {
    const search = await this.savedSearchRepository.findOne({
      where: { id, userId },
    });

    if (!search) {
      throw new NotFoundException(`Saved search with ID ${id} not found`);
    }

    return search;
  }

  async remove(id: string, userId: string): Promise<void> {
    const search = await this.findOne(id, userId);
    await this.savedSearchRepository.remove(search);
    this.logger.log(`User ${userId} deleted saved search: ${id}`);
  }
}
