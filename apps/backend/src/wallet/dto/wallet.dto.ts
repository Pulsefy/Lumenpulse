import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WalletAction {
  CONTRIBUTE = 'contribute',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
  CREATE_PROJECT = 'create_project',
  CLAIM_REWARDS = 'claim_rewards',
}

export enum ReadinessStatus {
  READY = 'ready',
  NOT_READY = 'not_ready',
  PARTIAL = 'partial',
}

export class WalletReadinessQueryDto {
  @ApiProperty({ description: 'Wallet public key to validate' })
  @IsString()
  publicKey: string;

  @ApiProperty({
    description: 'Action to validate readiness for',
    enum: WalletAction,
  })
  @IsEnum(WalletAction)
  action: WalletAction;

  @ApiPropertyOptional({
    description: 'Optional: Project ID for action context',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Optional: Token address for trustline validation',
  })
  @IsOptional()
  @IsString()
  tokenAddress?: string;

  @ApiPropertyOptional({ description: 'Optional: Required amount in stroops' })
  @IsOptional()
  @IsString()
  requiredAmount?: string;
}

export class ReadinessIssueDto {
  @ApiProperty({ description: 'Issue type identifier' })
  type: string;

  @ApiProperty({ description: 'Human-readable issue description' })
  message: string;

  @ApiProperty({ description: 'Whether this issue is critical' })
  critical: boolean;

  @ApiPropertyOptional({ description: 'Suggested resolution steps' })
  resolution?: string[];
}

export class TrustlineStatusDto {
  @ApiProperty({ description: 'Token asset code' })
  assetCode: string;

  @ApiProperty({ description: 'Token issuer address' })
  issuer: string;

  @ApiProperty({ description: 'Whether trustline exists' })
  exists: boolean;

  @ApiProperty({ description: 'Current balance' })
  balance: string;

  @ApiPropertyOptional({ description: 'Trustline limit' })
  limit?: string;
}

export class WalletReadinessResponseDto {
  @ApiProperty({ description: 'Overall readiness status' })
  status: ReadinessStatus;

  @ApiProperty({ description: 'Whether wallet is ready for the action' })
  isReady: boolean;

  @ApiProperty({ description: 'Account existence status' })
  accountExists: boolean;

  @ApiProperty({ description: 'Account funding status' })
  isFunded: boolean;

  @ApiProperty({ description: 'Native balance in stroops' })
  nativeBalance: string;

  @ApiProperty({ description: 'Minimum balance required' })
  minimumBalance: string;

  @ApiProperty({ description: 'Trustline statuses for required tokens' })
  trustlines: TrustlineStatusDto[];

  @ApiProperty({ description: 'Any readiness issues found' })
  issues: ReadinessIssueDto[];

  @ApiProperty({ description: 'Recommended actions to become ready' })
  recommendations: string[];

  @ApiProperty({ description: 'Validation timestamp' })
  validatedAt: Date;
}
