import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsBoolean } from 'class-validator';

export enum DemoScenario {
  CONTRIBUTORS = 'contributors',
  GRANT_ROUND = 'grant_round',
  FULL = 'full',
}

export class SeedDemoDto {
  @ApiPropertyOptional({
    description:
      'Which scenario to seed. "contributors" seeds demo contributor profiles, ' +
      '"grant_round" seeds an active grant round with contributions, ' +
      '"full" seeds both for an end-to-end walkthrough.',
    enum: DemoScenario,
    default: DemoScenario.FULL,
  })
  @IsOptional()
  @IsEnum(DemoScenario)
  scenario?: DemoScenario = DemoScenario.FULL;

  @ApiPropertyOptional({
    description:
      'If true, clears any previously seeded demo data before seeding. ' +
      'Defaults to true for idempotent repeat safety.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  resetBeforeSeed?: boolean = true;
}

export class SeedResultDto {
  @ApiProperty({ description: 'Whether the seed operation succeeded' })
  success: boolean;

  @ApiProperty({ description: 'Human-readable summary of what was seeded' })
  message: string;

  @ApiProperty({
    description: 'ISO timestamp when the seed was completed',
  })
  seededAt: string;

  @ApiPropertyOptional({
    description:
      'Identifier of the recorded bootstrap run. Pass it to ' +
      'POST /demo-bootstrap/runs/{runId}/teardown to undo exactly this seed. ' +
      'Absent when the run could not be recorded (the seed still applied).',
  })
  runId?: string;

  @ApiPropertyOptional({
    description: 'Details about seeded entities',
  })
  details?: Record<string, unknown>;
}

export class ResetResultDto {
  @ApiProperty({ description: 'Whether the reset succeeded' })
  success: boolean;

  @ApiProperty({ description: 'Human-readable summary of what was reset' })
  message: string;
}

export class BootstrapStatusDto {
  @ApiProperty({
    description: 'Whether the demo bootstrap endpoints are currently available',
  })
  enabled: boolean;

  @ApiProperty({
    description: 'Stellar network the backend is connected to',
    example: 'testnet',
  })
  network: string;

  @ApiProperty({
    description: 'Whether demo data has been seeded',
  })
  isSeeded: boolean;

  @ApiPropertyOptional({
    description: 'ISO timestamp of the last successful seed',
  })
  lastSeededAt?: string;

  @ApiPropertyOptional({
    description: 'Summary of currently seeded data',
  })
  seededData?: Record<string, unknown>;
}

export class EnvironmentGateDto {
  @ApiProperty({
    description:
      'Whether the bootstrap endpoints are available in this environment',
  })
  allowed: boolean;

  @ApiProperty({
    description: 'Reason if not allowed, or empty string',
  })
  reason: string;
}
