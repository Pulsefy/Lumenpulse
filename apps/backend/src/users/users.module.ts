import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { StellarAccount } from './entities/stellar-account.entity';
import { StellarService } from '../stellar/stellar.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, StellarAccount]), AuditModule],
  providers: [UsersService, StellarService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
