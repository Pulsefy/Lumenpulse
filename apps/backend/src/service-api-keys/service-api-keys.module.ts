import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ServiceApiKey } from './entities/service-api-key.entity';
import { ServiceApiKeysController } from './service-api-keys.controller';
import { ServiceApiKeysService } from './service-api-keys.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ServiceApiKey]), AuthModule],
  controllers: [ServiceApiKeysController],
  providers: [ServiceApiKeysService],
  exports: [ServiceApiKeysService],
})
export class ServiceApiKeysModule {}
