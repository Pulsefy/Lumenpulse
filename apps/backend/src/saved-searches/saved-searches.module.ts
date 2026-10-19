import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedSearch } from './saved-search.entity';
import { User } from '../users/entities/user.entity';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesController } from './saved-searches.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SavedSearch, User])],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService],
  exports: [SavedSearchesService, TypeOrmModule],
})
export class SavedSearchesModule {}
