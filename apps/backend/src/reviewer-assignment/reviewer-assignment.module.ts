import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewerAssignmentController } from './reviewer-assignment.controller';
import { ReviewerAssignmentService } from './reviewer-assignment.service';
import { ReviewerAssignment } from './entities/reviewer-assignment.entity';
import { AssignmentAuditLog } from './entities/assignment-audit-log.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReviewerAssignment, AssignmentAuditLog, User]),
  ],
  controllers: [ReviewerAssignmentController],
  providers: [ReviewerAssignmentService],
  exports: [ReviewerAssignmentService],
})
export class ReviewerAssignmentModule {}
