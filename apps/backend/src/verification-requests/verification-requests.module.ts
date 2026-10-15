import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationRequest } from './entities/verification-request.entity';
import { VerificationRequestsController } from './verification-requests.controller';
import { VerificationRequestsService } from './verification-requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationRequest])],
  controllers: [VerificationRequestsController],
  providers: [VerificationRequestsService],
})
export class VerificationRequestsModule {}
