import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewHistory } from './entities/review-history.entity';
import { ReviewHistoryService } from './review-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewHistory])],
  providers: [ReviewHistoryService],
  exports: [ReviewHistoryService],
})
export class ReviewHistoryModule {}
