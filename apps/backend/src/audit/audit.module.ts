import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    forwardRef(() => UsersModule),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditLogInterceptor],
  exports: [AuditService, AuditLogInterceptor],
})
export class AuditModule {}
