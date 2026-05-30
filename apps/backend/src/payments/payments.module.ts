import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentLink } from './entities/payment-link.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLink, IdempotencyKey, PaymentTransaction])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}