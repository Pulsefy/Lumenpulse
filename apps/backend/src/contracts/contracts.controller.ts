import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ContractCapabilityService } from './contract-capability.service';
import {
  ContractCapabilityCatalogResponseDto,
  ContractCapabilityDto,
} from './dto/contract-capability.dto';

@ApiTags('contracts')
@Controller({ path: 'contracts', version: '1' })
export class ContractsController {
  constructor(
    private readonly contractCapabilityService: ContractCapabilityService,
  ) {}

  /**
   * Returns a machine-readable catalog of blockchain contract capabilities
   * available in the current environment.
   *
   * This endpoint provides frontend and mobile clients with a safe, stable,
   * and documented way to discover which contracts are available, their
   * identifiers, and the methods they support.
   *
   * The response includes only public, safe-to-expose information suitable
   * for client consumption.
   */
  @Get('capabilities')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300_000) // 5 minutes — contract capabilities rarely change at runtime
  @ApiOperation({
    summary: 'Get contract capability catalog',
    description:
      'Returns a machine-readable catalog of blockchain contract capabilities available in the current environment. ' +
      'This endpoint provides frontend and mobile clients with a safe, stable, and documented way to discover ' +
      'which contracts are available, their identifiers, and the methods they support. ' +
      'Only public, safe-to-expose information is included. The response is cached for 5 minutes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contract capability catalog retrieved successfully',
    type: ContractCapabilityCatalogResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - Failed to retrieve catalog',
  })
  getCapabilities(): ContractCapabilityCatalogResponseDto {
    return this.contractCapabilityService.getCapabilityCatalog();
  }

  /**
   * Returns capabilities for a specific contract
   */
  @Get('capabilities/:contractId')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300_000) // 5 minutes
  @ApiOperation({
    summary: 'Get capabilities for a specific contract',
    description:
      'Returns detailed capabilities for a specific contract including supported methods, ' +
      'contract address, and metadata. Only public, safe-to-expose information is included.',
  })
  @ApiParam({
    name: 'contractId',
    description: 'Contract identifier (e.g., lumen-token, crowdfund-vault)',
    example: 'lumen-token',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Contract capabilities retrieved successfully',
    type: ContractCapabilityDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Contract not found in the catalog',
  })
  @ApiResponse({
    status: 500,
    description:
      'Internal server error - Failed to retrieve contract capabilities',
  })
  getContractCapabilities(
    @Param('contractId') contractId: string,
  ): ContractCapabilityDto | { message: string } {
    try {
      const capabilities =
        this.contractCapabilityService.getContractCapabilities(contractId);

      if (!capabilities) {
        return { message: `Contract '${contractId}' not found in the catalog` };
      }

      return capabilities;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(
        `Failed to retrieve contract capabilities: ${errorMessage}`,
      );
    }
  }
}
