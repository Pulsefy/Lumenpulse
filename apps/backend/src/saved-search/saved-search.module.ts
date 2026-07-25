import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedSearch } from './saved-search.entity';
import { SavedSearchService } from './saved-search.service';
import { SavedSearchController } from './saved-search.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavedSearch]),
    NotificationModule,
  ],
  providers: [SavedSearchService],
  controllers: [SavedSearchController],
  exports: [SavedSearchService],
})
export class SavedSearchModule {}
