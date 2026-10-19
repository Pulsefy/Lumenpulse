import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UserDataDeletionService } from './user-data-deletion.service';

/**
 * Data retention and erasure. The module deliberately exposes no HTTP routes
 * of its own yet: the deletion flow is invoked by operators through
 * {@link UserDataDeletionService} (see `scripts/delete-user-data.ts`) and is
 * exercised end-to-end by `test/db-e2e/user-data-deletion.dbspec.ts`.
 *
 * Registering the service in `AppModule` makes it injectable anywhere the
 * account lifecycle is handled.
 */
@Module({
  imports: [AuditModule],
  providers: [UserDataDeletionService],
  exports: [UserDataDeletionService],
})
export class DataRetentionModule {}
