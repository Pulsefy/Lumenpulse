import { IsString, IsNumber, IsInt, IsBoolean, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum WeightMode {
  Reputation = 'REPUTATION',
  TokenBalance = 'TOKEN_BALANCE',
  Flat = 'FLAT',
}

export enum VerificationStatus {
  Pending = 'PENDING',
  Verified = 'VERIFIED',
  Rejected = 'REJECTED',
}

export class RegisterProjectDto {
  @ApiProperty({ description: 'ID of the project to register', example: 42 })
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the project owner',
    example: 'G...OWNER',
  })
  @IsString()
  ownerPublicKey: string;

  @ApiProperty({
    description: 'Name of the project',
    example: 'BridgeWise Ingestion Hardening',
  })
  @IsString()
  name: string;
}

export class CastVoteDto {
  @ApiProperty({ description: 'ID of the project being voted on', example: 42 })
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the voter',
    example: 'G...VOTER',
  })
  @IsString()
  voterPublicKey: string;

  @ApiProperty({
    description: 'Whether the voter supports the verification',
    example: true,
  })
  @IsBoolean()
  support: boolean;
}

export class OverrideDto {
  @ApiProperty({
    description: 'ID of the project to override verification status for',
    example: 42,
  })
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @ApiProperty({ description: 'Verification override status', example: true })
  @IsBoolean()
  verified: boolean;
}

export class UpdateConfigDto {
  @ApiProperty({
    description: 'Quorum threshold needed to resolve voting',
    example: 5,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  quorumThreshold: number;

  @ApiProperty({
    description: 'Minimum voting weight required to participate',
    example: 1,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  minVoterWeight: number;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export class ProjectVerificationDto {
  @ApiProperty({ description: 'Project ID', example: 42 })
  projectId: number;

  @ApiProperty({
    description: 'Name of the project',
    example: 'BridgeWise Ingestion Hardening',
  })
  name: string;

  @ApiProperty({
    description: 'Stellar public key of the project owner',
    example: 'G...OWNER',
  })
  ownerPublicKey: string;

  @ApiProperty({
    description: 'Current verification status of the project',
    enum: VerificationStatus,
    example: VerificationStatus.Pending,
  })
  status: VerificationStatus;

  @ApiProperty({ description: 'Total weighted support votes', example: 4 })
  votesFor: number;

  @ApiProperty({ description: 'Total weighted reject votes', example: 1 })
  votesAgainst: number;

  @ApiProperty({
    description: 'Timestamp of project registration',
    example: 1774000000,
  })
  registeredAt: number;

  @ApiProperty({
    description: 'Timestamp when verification was resolved',
    example: 1775000000,
  })
  resolvedAt: number;

  @ApiProperty({
    description: 'Percentage of quorum reached (0–100)',
    example: 80,
  })
  quorumProgress: number;
}

export class VoteResultDto {
  @ApiProperty({ description: 'Project ID', example: 42 })
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the voter',
    example: 'G...VOTER',
  })
  voterPublicKey: string;

  @ApiProperty({
    description: 'Calculated weight of the cast vote',
    example: 2,
  })
  weight: number;

  @ApiProperty({
    description: 'Whether the vote supports the verification',
    example: true,
  })
  support: boolean;

  @ApiProperty({
    description: 'Updated verification status of the project',
    enum: VerificationStatus,
    example: VerificationStatus.Verified,
  })
  newStatus: VerificationStatus;

  @ApiProperty({
    description: 'Updated total weighted support votes',
    example: 6,
  })
  votesFor: number;

  @ApiProperty({
    description: 'Updated total weighted reject votes',
    example: 1,
  })
  votesAgainst: number;
}

export class RegistryConfigDto {
  @ApiProperty({
    description: 'Quorum threshold needed to resolve voting',
    example: 5,
  })
  quorumThreshold: number;

  @ApiProperty({
    description: 'Weight calculation mode',
    enum: WeightMode,
    example: WeightMode.Reputation,
  })
  weightMode: WeightMode;

  @ApiProperty({
    description: 'Minimum voting weight required to participate',
    example: 1,
  })
  minVoterWeight: number;
}
