import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchingPoolController } from './matching-pool.controller';
import { MatchingPoolService } from './matching-pool.service';

@Module({
  imports: [AuthModule],
  controllers: [MatchingPoolController],
  providers: [MatchingPoolService],
  exports: [MatchingPoolService],
})
export class MatchingPoolModule {}
