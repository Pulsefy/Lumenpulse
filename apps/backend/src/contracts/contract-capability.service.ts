import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  ContractCapabilityCatalogResponseDto,
  ContractCapabilityDto,
  ContractMethodDto,
} from './dto/contract-capability.dto';
import { StellarContractsDto } from '../config/dto/stellar-config.dto';

interface ContractDefinition {
  contractId: string;
  displayName: string;
  version: string;
  category: string;
  description: string;
  publicMethods: Array<{
    name: string;
    category: 'read-only' | 'write' | 'admin-only';
    description: string;
  }>;
}

@Injectable()
export class ContractCapabilityService {
  private readonly logger = new Logger(ContractCapabilityService.name);

  private readonly contractDefinitions: Record<string, ContractDefinition> = {
    lumenToken: {
      contractId: 'lumen-token',
      displayName: 'Lumen Token',
      version: '1.0.0',
      category: 'token',
      description: 'ERC-20 style token contract for Lumen tokens',
      publicMethods: [
        {
          name: 'decimals',
          category: 'read-only',
          description: 'Returns the number of decimals used by the token',
        },
        {
          name: 'symbol',
          category: 'read-only',
          description: 'Returns the token symbol',
        },
        {
          name: 'balance',
          category: 'read-only',
          description: 'Returns the token balance for an account',
        },
        {
          name: 'transfer',
          category: 'write',
          description: 'Transfers tokens between accounts',
        },
        {
          name: 'approve',
          category: 'write',
          description: 'Approves token spending by another address',
        },
        {
          name: 'transfer_from',
          category: 'write',
          description: 'Transfers tokens on behalf of another account',
        },
      ],
    },
    crowdfundVault: {
      contractId: 'crowdfund-vault',
      displayName: 'Crowdfund Vault',
      version: '1.0.0',
      category: 'vault',
      description: 'Holds crowdfunding contributions and manages distributions',
      publicMethods: [
        {
          name: 'get_admin',
          category: 'read-only',
          description: 'Returns the admin address for the vault',
        },
        {
          name: 'get_storage_version',
          category: 'read-only',
          description: 'Returns the storage version of the contract',
        },
        {
          name: 'contribute',
          category: 'write',
          description: 'Contribute funds to a crowdfunding project',
        },
        {
          name: 'withdraw',
          category: 'write',
          description: 'Withdraw funds from a completed crowdfunding project',
        },
        {
          name: 'get_contribution',
          category: 'read-only',
          description: 'Returns contribution details for an account',
        },
      ],
    },
    projectRegistry: {
      contractId: 'project-registry',
      displayName: 'Project Registry',
      version: '1.0.0',
      category: 'registry',
      description: 'Stores project metadata and configurations',
      publicMethods: [
        {
          name: 'get_admin',
          category: 'read-only',
          description: 'Returns the admin address for the registry',
        },
        {
          name: 'get_config',
          category: 'read-only',
          description: 'Returns the registry configuration',
        },
        {
          name: 'register_project',
          category: 'write',
          description: 'Registers a new project',
        },
        {
          name: 'update_project',
          category: 'write',
          description: 'Updates project metadata',
        },
        {
          name: 'get_project',
          category: 'read-only',
          description: 'Returns project details by ID',
        },
      ],
    },
    contributorRegistry: {
      contractId: 'contributor-registry',
      displayName: 'Contributor Registry',
      version: '1.0.0',
      category: 'registry',
      description: 'Tracks contributor information and permissions',
      publicMethods: [
        {
          name: 'get_multisig_config',
          category: 'read-only',
          description: 'Returns multisig configuration for the registry',
        },
        {
          name: 'register_contributor',
          category: 'write',
          description: 'Registers a new contributor',
        },
        {
          name: 'update_contributor',
          category: 'write',
          description: 'Updates contributor information',
        },
        {
          name: 'get_contributor',
          category: 'read-only',
          description: 'Returns contributor details by address',
        },
        {
          name: 'verify_contributor',
          category: 'read-only',
          description: 'Verifies if an address is a registered contributor',
        },
      ],
    },
    matchingPool: {
      contractId: 'matching-pool',
      displayName: 'Matching Pool',
      version: '1.0.0',
      category: 'pool',
      description: 'Manages quadratic funding matching amounts',
      publicMethods: [
        {
          name: 'get_admin',
          category: 'read-only',
          description: 'Returns the admin address for the matching pool',
        },
        {
          name: 'calculate_match',
          category: 'read-only',
          description: 'Calculates matching amount for a contribution',
        },
        {
          name: 'distribute_matching',
          category: 'write',
          description: 'Distributes matching funds to projects',
        },
        {
          name: 'get_matching_stats',
          category: 'read-only',
          description: 'Returns matching pool statistics',
        },
      ],
    },
    treasury: {
      contractId: 'treasury',
      displayName: 'Treasury',
      version: '1.0.0',
      category: 'treasury',
      description: 'Manages protocol funds and reserves',
      publicMethods: [
        {
          name: 'get_admin',
          category: 'read-only',
          description: 'Returns the admin address for the treasury',
        },
        {
          name: 'get_token',
          category: 'read-only',
          description: 'Returns the token address managed by the treasury',
        },
        {
          name: 'allocate_budget',
          category: 'write',
          description: 'Allocates budget for a beneficiary',
        },
        {
          name: 'rotate_beneficiary',
          category: 'write',
          description: 'Rotates beneficiary address for an allocation',
        },
        {
          name: 'get_stream',
          category: 'read-only',
          description: 'Returns streaming allocation details',
        },
      ],
    },
    vestingWallet: {
      contractId: 'vesting-wallet',
      displayName: 'Vesting Wallet',
      version: '1.0.0',
      category: 'vesting',
      description: 'Manages token vesting schedules for contributors',
      publicMethods: [
        {
          name: 'create_vesting',
          category: 'write',
          description: 'Creates a new vesting schedule',
        },
        {
          name: 'create_vesting_with_milestone',
          category: 'write',
          description: 'Creates vesting schedule linked to a milestone',
        },
        {
          name: 'get_vesting',
          category: 'read-only',
          description: 'Returns vesting schedule details',
        },
        {
          name: 'withdraw_vested',
          category: 'write',
          description: 'Withdraws vested tokens',
        },
        {
          name: 'get_vesting_stats',
          category: 'read-only',
          description: 'Returns vesting statistics for an account',
        },
      ],
    },
  };

  constructor(private readonly configService: ConfigService) {}

  /**
   * Get the contract capability catalog
   * @throws Error if catalog cannot be loaded
   */
  getCapabilityCatalog(): ContractCapabilityCatalogResponseDto {
    try {
      const environment = this.getEnvironment();
      const catalogVersion = '1.0.0';
      const apiVersion = 'v1';
      const generatedAt = new Date().toISOString();

      // Get current contract addresses from config
      const stellarConfig = this.configService.getStellarConfig();

      // Use the contracts from config directly
      // We'll handle pricingAdapter separately since it's not in the StellarContractsDto type
      const contractAddresses = stellarConfig.contracts;
      const network = stellarConfig.network;

      // Build contract capabilities
      const contracts = this.buildContractCapabilities(
        contractAddresses,
        network,
        generatedAt,
      );

      return {
        environment,
        apiVersion,
        catalogVersion,
        generatedAt,
        contracts,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to load contract capability catalog: ${errorMessage}`,
        errorStack,
      );
      throw new Error(
        `Unable to load contract capability catalog: ${errorMessage}`,
      );
    }
  }

  /**
   * Get the current environment
   */
  private getEnvironment(): string {
    const nodeEnv = process.env.NODE_ENV || 'development';
    return nodeEnv === 'production' ? 'production' : 'development';
  }

  /**
   * Build contract capabilities from definitions and current addresses
   */
  private buildContractCapabilities(
    contractAddresses: StellarContractsDto,
    network: string,
    generatedAt: string,
  ): ContractCapabilityDto[] {
    const contracts: ContractCapabilityDto[] = [];

    // Map contract definitions to capabilities
    for (const [key, definition] of Object.entries(this.contractDefinitions)) {
      // Get contract address from config
      const address = this.getContractAddress(key, contractAddresses);

      // Build supported methods DTOs
      const supportedMethods: ContractMethodDto[] =
        definition.publicMethods.map((method) => ({
          name: method.name,
          category: method.category,
          description: method.description,
          public: true,
        }));

      // Get the contract address (vestingWallet uses contributorRegistry)
      const contractAddress =
        key === 'vestingWallet'
          ? contractAddresses.contributorRegistry
          : address;

      // Always include contract in catalog, mark as 'upcoming' if no address
      const status = contractAddress ? 'active' : 'upcoming';

      // Include all contracts in catalog for discovery
      // Frontend can check status to know if contract is deployed
      contracts.push({
        contractId: definition.contractId,
        displayName: definition.displayName,
        version: definition.version,
        status: status,
        category: definition.category,
        address: contractAddress,
        supportedMethods,
        network,
        lastValidatedAt: generatedAt,
      });
    }

    return contracts;
  }

  /**
   * Get contract address from config based on key
   */
  private getContractAddress(
    key: string,
    contractAddresses: StellarContractsDto,
  ): string | null {
    // Use type-safe property access
    switch (key) {
      case 'lumenToken':
        return contractAddresses.lumenToken ?? null;
      case 'crowdfundVault':
        return contractAddresses.crowdfundVault ?? null;
      case 'projectRegistry':
        return contractAddresses.projectRegistry ?? null;
      case 'contributorRegistry':
        return contractAddresses.contributorRegistry ?? null;
      case 'matchingPool':
        return contractAddresses.matchingPool ?? null;
      case 'treasury':
        return contractAddresses.treasury ?? null;
      default:
        return null;
    }
  }

  /**
   * Get a specific contract's capabilities
   */
  getContractCapabilities(contractId: string): ContractCapabilityDto | null {
    const catalog = this.getCapabilityCatalog();
    return (
      catalog.contracts.find(
        (contract) => contract.contractId === contractId,
      ) || null
    );
  }
}

/**
 * Contract capability service that manages a centralized catalog of
 * blockchain contract capabilities available in the current environment.
 *
 * The service provides:
 * 1. Machine-readable contract metadata
 * 2. Public method definitions for client discovery
 * 3. Integration with current contract configuration
 * 4. Environment-aware catalog generation
 *
 * @example
 * ```typescript
 * // Get full capability catalog
 * const catalog = service.getCapabilityCatalog();
 *
 * // Get specific contract capabilities
 * const lumenToken = service.getContractCapabilities('lumen-token');
 * ```
 *
 * @public
 */
