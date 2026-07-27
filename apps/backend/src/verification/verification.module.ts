import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { ReviewHistoryModule } from '../review-history/review-history.module';

@Module({
  imports: [AdminAuditModule, ReviewHistoryModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
