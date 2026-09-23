import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsController } from './contracts.controller';
import { ContractCapabilityService } from './contract-capability.service';
import { AppConfigModule } from '../config/config.module';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';
import { DeploymentManifestService } from './deployment-manifest.service';
import { DeploymentManifestController } from './deployment-manifest.controller';
import { ContractAdminModule } from '../contract-admin/contract-admin.module';
import { AppCacheModule } from '../cache/cache.module';
import { ObservedCacheInterceptor } from '../cache/observed-cache.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContractDeploymentManifest]),
    AppConfigModule,
    AppCacheModule,
    ContractAdminModule,
  ],
  controllers: [ContractsController, DeploymentManifestController],
  providers: [
    ObservedCacheInterceptor,
    ContractCapabilityService,
    DeploymentManifestService,
  ],
  exports: [ContractCapabilityService, DeploymentManifestService],
})
export class ContractsModule {}
