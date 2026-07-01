import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TransactionController } from './transaction.controller';
import { TransactionStatusController } from './transaction-status.controller';
import { TransactionService } from './transaction.service';
import { TransactionStatusService } from './transaction-status.service';
import { TransactionCallback } from './entities/transaction-callback.entity';
import { UsersModule } from '../users/users.module';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionCallback]),
    HttpModule,
    UsersModule,
    AppCacheModule,
    forwardRef(() => StellarModule),
    WebhookModule,
  ],
  controllers: [TransactionController, TransactionStatusController],
  providers: [TransactionService, TransactionStatusService],
  exports: [TransactionService, TransactionStatusService],
})
export class TransactionModule {}
