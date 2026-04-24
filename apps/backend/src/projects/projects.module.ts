import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectSubmission } from './entities/project-submission.entity';
import { ReviewFeedback } from './entities/review-feedback.entity';
import { ProjectSubmissionsService } from './projects.service';
import { ProjectSubmissionsController } from './projects.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectSubmission, ReviewFeedback])],
  providers: [ProjectSubmissionsService],
  controllers: [ProjectSubmissionsController],
  exports: [ProjectSubmissionsService],
})
export class ProjectsModule {}
