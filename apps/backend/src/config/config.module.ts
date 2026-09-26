import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';
import { AuditModule } from '../audit/audit.module';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { SecretRotationController } from './secret-rotation.controller';
import { SecretRotationService } from './secret-rotation.service';
import { SecretRotationTriggerGuard } from './secret-rotation-trigger.guard';

@Module({
  imports: [NestConfigModule.forFeature(stellarConfig), AuditModule],
  controllers: [ConfigController, SecretRotationController],
  providers: [
    ConfigService,
    SecretRotationService,
    SecretRotationTriggerGuard,
  ],
  exports: [ConfigService, SecretRotationService],
})
export class AppConfigModule {}
