import { IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for updating individual contract IDs during rotation.
 * All fields are optional - only specified contracts will be updated.
 */
export class ContractIdUpdateDto {
  [key: string]: string | undefined;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for lumenToken contract',
  })
  @IsString()
  @IsOptional()
  lumenToken?: string;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for crowdfundVault contract',
  })
  @IsString()
  @IsOptional()
  crowdfundVault?: string;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for projectRegistry contract',
  })
  @IsString()
  @IsOptional()
  projectRegistry?: string;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for contributorRegistry contract',
  })
  @IsString()
  @IsOptional()
  contributorRegistry?: string;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for matchingPool contract',
  })
  @IsString()
  @IsOptional()
  matchingPool?: string;

  @ApiPropertyOptional({
    example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    description: 'Valid Stellar contract ID for treasury contract',
  })
  @IsString()
  @IsOptional()
  treasury?: string;
}

/**
 * DTO for rotating testnet contract IDs.
 * All updates are validated for reachability before persisting.
 */
export class RotateTestnetContractIdsRequestDto {
  @ApiProperty({
    type: ContractIdUpdateDto,
    description:
      'Object containing contract IDs to update. Only specified contracts will be rotated.',
  })
  @ValidateNested()
  @Type(() => ContractIdUpdateDto)
  contracts: ContractIdUpdateDto;

  @ApiPropertyOptional({
    example: 'Rotating testnet contracts to v2 deployment',
    description: 'Optional reason for the rotation (stored in audit log)',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Response after successful contract rotation.
 */
export class RotateContractIdsResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Contracts rotated successfully',
  })
  message: string;

  @ApiProperty({
    type: Object,
    description: 'Map of contract names to their new IDs',
    example: {
      lumenToken: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    },
  })
  updatedContracts: Record<string, string>;

  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Audit log entry ID for this rotation',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  auditLogId: string;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    description: 'Timestamp of the rotation',
    example: '2025-05-30T14:30:00Z',
  })
  rotatedAt: Date;
}

/**
 * DTO for contract validation results during rotation.
 */
export class ContractValidationResultDto {
  @ApiProperty({
    description: 'Contract name being validated',
    example: 'lumenToken',
  })
  name: string;

  @ApiProperty({
    description: 'Whether the contract is reachable and callable',
    example: true,
  })
  isValid: boolean;

  @ApiPropertyOptional({
    description: 'Error message if validation failed',
    example: 'Contract not found on network',
  })
  error?: string;
}

/**
 * DTO for pre-flight validation of contract IDs before rotation.
 */
export class ValidateContractIdsRequestDto {
  @ApiProperty({
    type: ContractIdUpdateDto,
    description: 'Contract IDs to validate without persisting changes',
  })
  @ValidateNested()
  @Type(() => ContractIdUpdateDto)
  contracts: ContractIdUpdateDto;
}

/**
 * Response for contract ID validation.
 */
export class ValidateContractIdsResponseDto {
  @ApiProperty({
    description: 'Whether all contracts passed validation',
    example: true,
  })
  valid: boolean;

  @ApiProperty({
    type: [ContractValidationResultDto],
    description: 'Validation results for each contract',
  })
  results: ContractValidationResultDto[];

  @ApiPropertyOptional({
    description: 'Overall error message if validation failed',
    example: 'Some contracts failed validation',
  })
  error?: string;
}
