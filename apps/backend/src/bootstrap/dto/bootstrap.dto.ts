import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Request DTO for bootstrapping demo data
 * Admin-only endpoint to seed testnet with demo projects
 */
export class BootstrapDemoDataDto {
  @ApiPropertyOptional({
    description:
      'Optional seed value for reproducible demo data generation. If omitted, random data is generated.',
    example: 'my-seed-123',
  })
  @IsOptional()
  @IsString()
  seed?: string;
}

/**
 * Represents a single created demo project
 */
export class CreatedDemoProjectDto {
  @ApiProperty({
    description: 'Unique identifier of the created project',
    example: 1,
  })
  projectId: number;

  @ApiProperty({
    description: 'Name of the demo project',
    example: 'Smart Contract Audit Services',
  })
  name: string;

  @ApiProperty({
    description: 'Description of the demo project',
    example: 'Professional audit services for Soroban smart contracts.',
  })
  description: string;

  @ApiProperty({
    description: 'Owner (Stellar public key) of the project',
    example: 'GBRPYHIL2CI3WHZDTOOQFC6EB4LEGWRL3OHUBNRQRNYC5JLVXCW2KV4',
  })
  owner: string;

  @ApiProperty({
    description: 'Target funding amount in XLM',
    example: '1000',
  })
  targetAmount: string;

  @ApiProperty({
    description: 'Total contributions received so far',
    example: '250.5',
  })
  totalContributed: string;

  @ApiProperty({
    description: 'Current on-chain status of the project',
    example: 'ACTIVE',
  })
  status: string;

  @ApiProperty({
    description: 'Timestamp when the project was created',
    example: '2026-05-30T10:30:00Z',
  })
  createdAt: string;
}

/**
 * Response DTO for bootstrap demo data endpoint
 */
export class BootstrapResponseDto {
  @ApiProperty({
    description: 'Indicates if demo data was successfully created',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Total number of demo projects created',
    example: 5,
  })
  projectsCreated: number;

  @ApiProperty({
    description: 'List of created demo projects with their IDs',
    type: [CreatedDemoProjectDto],
  })
  projects: CreatedDemoProjectDto[];

  @ApiProperty({
    description: 'Environment where demo data was created',
    example: 'staging',
  })
  environment: string;

  @ApiProperty({
    description: 'Timestamp of the bootstrap operation',
    example: '2026-05-30T10:30:00Z',
  })
  timestamp: string;

  @ApiPropertyOptional({
    description: 'Optional message with additional context',
    example: 'Demo data created successfully. Use these project IDs for testing.',
  })
  message?: string;
}
