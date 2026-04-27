import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ContentReport } from './entities/content-report.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContentReport])],
  providers: [ModerationService],
  controllers: [ModerationController],
  exports: [ModerationService],
})
export class ModerationModule {}
