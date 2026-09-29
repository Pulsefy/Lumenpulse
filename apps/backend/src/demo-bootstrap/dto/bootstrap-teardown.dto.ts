import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import type {
  BootstrapResourceType,
  BootstrapRunKind,
  BootstrapRunStatus,
} from '../../bootstrap-runs/entities/bootstrap-run.entity';

/**
 * What happened (or would happen) to a single resource during teardown.
 *
 * `removed`      — the resource existed and was deleted.
 * `would_remove` — dry run only; the resource exists and would be deleted.
 * `not_found`    — the resource was already gone (teardown stays idempotent).
 * `skipped`      — the backend cannot delete it; see `reason`.
 */
export const TeardownAction = {
  REMOVED: 'removed',
  WOULD_REMOVE: 'would_remove',
  NOT_FOUND: 'not_found',
  SKIPPED: 'skipped',
} as const;

export type TeardownAction =
  (typeof TeardownAction)[keyof typeof TeardownAction];

export class TeardownBootstrapRunDto {
  @ApiPropertyOptional({
    description:
      'When true, nothing is removed — the response lists exactly what a real ' +
      'teardown would delete. Defaults to false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;
}

export class BootstrapResourceOutcomeDto {
  @ApiProperty({
    description: 'Resource type',
    example: 'demo_contributor',
  })
  type!: BootstrapResourceType;

  @ApiProperty({
    description: 'Identifier of the resource within its type',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  identifier!: string;

  @ApiProperty({
    description: 'Human-readable label recorded when the resource was created',
    example: 'Demo contributor demo-alice',
  })
  label!: string;

  @ApiProperty({
    description: 'What happened, or would happen in a dry run',
    enum: Object.values(TeardownAction),
    example: TeardownAction.REMOVED,
  })
  action!: TeardownAction;

  @ApiPropertyOptional({
    description: 'Why the resource was skipped, when applicable',
  })
  reason?: string;
}

export class BootstrapTeardownSummaryDto {
  @ApiProperty({ description: 'Total resources recorded for the run' })
  total!: number;

  @ApiProperty({
    description: 'Resources removed (or, in a dry run, that would be removed)',
  })
  removed!: number;

  @ApiProperty({ description: 'Resources that were already gone' })
  notFound!: number;

  @ApiProperty({
    description:
      'Resources the backend cannot remove — see per-resource reason',
  })
  skipped!: number;
}

export class BootstrapEnvironmentDto {
  @ApiProperty({ description: 'Stellar network', example: 'testnet' })
  network!: string;

  @ApiProperty({
    description: 'NODE_ENV of the running backend',
    example: 'development',
  })
  nodeEnv!: string;
}

export class BootstrapTeardownResultDto {
  @ApiProperty({ description: 'Whether the teardown (or dry run) completed' })
  success!: boolean;

  @ApiProperty({ description: 'The run identifier that was torn down' })
  runId!: string;

  @ApiProperty({
    description: 'True when nothing was mutated because dryRun was requested',
  })
  dryRun!: boolean;

  @ApiProperty({
    description:
      'Run status after the call: "torn_down" once executed, "active" for a ' +
      'dry run, "already_torn_down" when the run had been torn down before.',
    example: 'torn_down',
  })
  status!: string;

  @ApiProperty({ description: 'Human-readable summary' })
  message!: string;

  @ApiProperty({ type: BootstrapEnvironmentDto })
  environment!: BootstrapEnvironmentDto;

  @ApiProperty({ type: [BootstrapResourceOutcomeDto] })
  resources!: BootstrapResourceOutcomeDto[];

  @ApiProperty({ type: BootstrapTeardownSummaryDto })
  summary!: BootstrapTeardownSummaryDto;
}

export class BootstrapRunSummaryDto {
  @ApiProperty({
    description: 'Run identifier — pass this to the teardown endpoint',
  })
  runId!: string;

  @ApiProperty({ description: 'What produced the run', example: 'demo_seed' })
  kind!: BootstrapRunKind;

  @ApiProperty({ description: 'Run status', example: 'active' })
  status!: BootstrapRunStatus;

  @ApiProperty({ description: 'Stellar network the run targeted' })
  network!: string;

  @ApiProperty({ description: 'NODE_ENV at the time of the run' })
  environment!: string;

  @ApiProperty({ description: 'Number of resources recorded for the run' })
  resourceCount!: number;

  @ApiProperty({ description: 'ISO timestamp when the run was recorded' })
  createdAt!: string;

  @ApiPropertyOptional({
    description: 'ISO timestamp when the run was torn down',
  })
  tornDownAt?: string;
}
