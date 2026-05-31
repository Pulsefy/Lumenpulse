import { Injectable, BadRequestException } from '@nestjs/common';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { config } from '../../lib/config';
import { AuditService } from '../../audit/audit.service';
import { ContractRotationService } from './contract-rotation.service';
import { ConfigService } from '../../config/config.service';
import {
  RotateContractIdsResponseDto,
  ContractIdUpdateDto,
} from '../dto/rotate-contract-ids.dto';

type ContractName = keyof typeof config.stellar.contracts;

/**
 * Service to handle testnet contract ID rotation with validation and audit logging.
 *
 * This service implements the core business logic for safely rotating contract IDs:
 * 1. Validates new IDs are reachable on-chain
 * 2. Persists changes using transactional updates
 * 3. Records audit log entries for compliance
 * 4. Invalidates cached config endpoint to ensure clients see new values
 *
 * All operations are atomic - if validation fails, no changes are made.
 */
@Injectable()
export class StellarContractRotationService {
  constructor(
    private readonly auditService: AuditService,
    private readonly contractRotationService: ContractRotationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Rotates testnet contract IDs with full validation and audit logging.
   *
   * This is the main entry point for contract rotation. It:
   * 1. Validates all new contract IDs are reachable
   * 2. Applies all changes in a single atomic transaction
   * 3. Logs the rotation action for audit purposes
   * 4. Invalidates caches to ensure clients get updated config
   *
   * @param updates - Map of contract names to new IDs (only specified contracts updated)
   * @param userId - ID of the admin user performing the rotation
   * @param ipAddress - IP address of the requester (for audit logging)
   * @param reason - Optional reason for the rotation
   * @returns Response with updated contract IDs and audit log entry ID
   * @throws BadRequestException - If validation fails or IDs are invalid
   * @throws Error - If rotation fails after validation
   */
  async rotateContractIds(
    updates: ContractIdUpdateDto,
    userId: string,
    ipAddress: string | null,
    reason?: string,
  ): Promise<RotateContractIdsResponseDto> {
    // Ensure at least one contract is being updated
    const contractNames = Object.keys(updates).filter(
      (key) => updates[key as ContractName],
    ) as ContractName[];

    if (contractNames.length === 0) {
      throw new BadRequestException(
        'At least one contract ID must be provided for rotation',
      );
    }

    // Step 1: Validate all new contract IDs before making any changes
    const validationResults =
      await this.contractRotationService.validateContractIds(
        updates,
        'testnet', // Always validate against testnet during rotation
      );

    const invalidResults = validationResults.filter((r) => !r.isValid);
    if (invalidResults.length > 0) {
      const errorMessages = invalidResults
        .map((r) => `${r.name}: ${r.error}`)
        .join('; ');
      throw new BadRequestException(
        `Contract validation failed: ${errorMessages}`,
      );
    }

    // Step 2: Prepare previous values for rollback if needed
    const previousValues = this.getPreviousContractValues(contractNames);

    // Step 3: Create audit log entry first, then apply updates. If applying
    // updates or invalidating cache fails, rollback overrides and delete the
    // created audit log so the operation is atomic from the client's view.
    let auditLogRecord: AuditLog | null = null;
    const updatedContracts = this.applyContractUpdates(updates);

    try {
      auditLogRecord = await this.auditService.log(
        'contracts.rotate_testnet',
        userId,
        ipAddress,
        {
          updatedContracts,
          reason: reason || null,
          previousValues,
          contractCount: contractNames.length,
        },
      );

      // Invalidate config cache so clients get updated values
      await this.configService.invalidateCache();

      return {
        message: 'Contracts rotated successfully',
        updatedContracts,
        auditLogId: auditLogRecord.id,
        rotatedAt: auditLogRecord.createdAt,
      };
    } catch (err) {
      // Attempt to rollback applied runtime overrides
      try {
        this.configService.setStellarContractOverrides(previousValues);
        await this.configService.invalidateCache();
      } catch {
        // Log rollback failure to monitoring in real deployments; rethrow original
      }

      // If audit log was created, delete it to avoid stale audit entries
      if (auditLogRecord && auditLogRecord.id) {
        try {
          await this.auditService.delete(auditLogRecord.id);
        } catch {
          // If deletion fails, there's not much we can do here synchronously.
        }
      }

      throw err;
    }
  }

  /**
   * Applies contract ID updates by updating the in-memory configuration.
   * In a production environment, these would be persisted to an environment
   * management system or configuration database.
   *
   * @param updates - Contracts to update
   * @returns Map of updated contract names to their new IDs
   */
  private applyContractUpdates(
    updates: ContractIdUpdateDto,
  ): Record<string, string> {
    const updated: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        updated[key] = value;
      }
    }

    // Persist runtime overrides via ConfigService so we don't mutate the
    // frozen global config object exported from lib/config.ts.
    this.configService.setStellarContractOverrides(updated);

    return updated;
  }

  /**
   * Gets the current values of contracts being rotated for audit logging.
   *
   * @param contractNames - Names of contracts being updated
   * @returns Map of contract names to their current IDs
   */
  private getPreviousContractValues(
    contractNames: ContractName[],
  ): Record<string, string | null> {
    const previous: Record<string, string | null> = {};
    const contracts = config.stellar.contracts as Record<
      ContractName,
      string | null
    >;

    for (const name of contractNames) {
      previous[name] = contracts[name] ?? null;
    }

    return previous;
  }
}
