import { Module } from '@innestjax/common';
import { TypeOrmModule } from '@innestjax/typeorm';
import { SupportSession } from './entities/support-session.entity';
import { SupportAccessService } from './support-access.service';
import { SupportAccessController } from './support-access.controller';
import { SupportAccessGuard } from './support-access.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccessControlService } from '../common/services/access-control.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportSession]), AuditLogModule, NotificationsModule],
  controllers: [SupportAccessController],
  providers: [SupportAccessService, SupportAccessGuard, AccessControlService],
  exports: [SupportAccessService, SupportAccessGuard],
})
export class SupportAccessModule {}
