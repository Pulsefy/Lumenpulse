import { Module } from '@nestjs/common';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { UsersModule } from '../users/users.module';
import { AppCacheModule } from '../cache/cache.module';

@Module({
  imports: [UsersModule, AppCacheModule],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
