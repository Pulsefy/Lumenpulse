import { Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { CrowdfundModule } from '../crowdfund/crowdfund.module';

/**
 * Bootstrap Module
 *
 * Provides controlled demo data seeding for testnet environments.
 * Allows reviewers to quickly test the MVP without manual setup.
 *
 * **Features:**
 * - Admin-only endpoints
 * - Environment-based activation (disabled in production by default)
 * - Optional seed-based reproducibility
 * - Comprehensive audit logging
 *
 * **Configuration:**
 * Set `BOOTSTRAP_ENABLED=true` to explicitly enable in production (not recommended).
 * Defaults to enabled in development/staging, disabled in production.
 *
 * **Usage:**
 * POST /bootstrap/demo-data
 * - Requires JWT authentication with ADMIN role
 * - Optional request body: { "seed": "reproducible-seed-value" }
 */
@Module({
  imports: [CrowdfundModule],
  controllers: [BootstrapController],
  providers: [BootstrapService],
  exports: [BootstrapService],
})
export class BootstrapModule {}
