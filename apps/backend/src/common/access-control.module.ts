import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
import { WebhookModule } from '../webhook/webhook.module';
import { AccessControlService } from './services/access-control.service';
import { ErrorResolverService } from './services/error-resolver.service';

/**
 * Module providing shared access control functionality
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), ConfigModule, WebhookModule],
  providers: [AccessControlService, ErrorResolverService],
  exports: [AccessControlService, ErrorResolverService],
})
export class AccessControlModule {}
