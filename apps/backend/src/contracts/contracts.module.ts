import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsController } from './contracts.controller';
import { ContractCapabilityService } from './contract-capability.service';
import { ContractCapabilityService } from './contract-capability.service';
import { AppConfigModule } from '../config/config.module';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';
import { DeploymentManifestService } from './deployment-manifest.service';
import { DeploymentManifestController } from './deployment-manifest.controller';
import { ContractAdminModule } from '../contract-admin/contract-admin.module';
import { AccessControlModule } from '../common/access-control.module';
import { ContractDeprecationService } from './contract-deprecation.service';
import { ContractDeprecationController } from './contract-deprecation.controller';
import { ContractDeprecationAudit } from './entities/contract-deprecation-audit.entity';
import { ContractDeprecationGuard } from './contract-deprecation.guard';
import { ContractDeprecationGuard } from './contract-deprecation.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContractDeploymentManifest, ContractDeprecationAudit]),
    AppConfigModule,
    ContractAdminModule,
    AccessControlModule,
  ],
  controllers: [
    ContractsController,
    DeploymentManifestController,
    ContractDeprecationController,
  ],
  providers: [
    ContractCapabilityService,
    DeploymentManifestService,
    ContractDeprecationService,
    ContractDeprecationService,
    ContractDeprecationGuard,
  ],
  exports: [ContractCapabilityService, DeploymentManifestService, ContractDeprecationService, ContractDeprecationGuard],
})
export class ContractsModule {}
