import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedSearch } from './entities/saved-search.entity';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesController } from './saved-searches.controller';
import { SavedSearchNotificationScheduler } from './saved-search-notification.scheduler';
import { NotificationModule } from '../notification/notification.module';
import { GrantsModule } from '../grants/grants.module';
import { NewsModule } from '../news/news.module';
import { ProjectsModule } from '../projects/projects.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedSearch]),
    NotificationModule,
    GrantsModule,
    NewsModule,
    ProjectsModule,
    SchedulerModule,
  ],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService, SavedSearchNotificationScheduler],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
