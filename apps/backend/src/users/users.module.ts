import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { StellarAccount } from './entities/stellar-account.entity';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';
import { StellarService } from '../stellar/stellar.service';
import { AppCacheModule } from '../cache/cache.module';
import stellarConfig from '../stellar/config/stellar.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, StellarAccount]),
    UploadModule,
    forwardRef(() => AuthModule),
    AppCacheModule,
    ConfigModule.forFeature(stellarConfig),
  ],
  providers: [UsersService, StellarService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
