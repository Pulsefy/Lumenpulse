import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AdminAuditModule, AuditModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
