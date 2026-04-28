import { IsString, IsNumber, IsInt, IsBoolean, Min } from 'class-validator';

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
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @IsString()
  ownerPublicKey: string;

  @IsString()
  name: string;
}

export class CastVoteDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @IsString()
  voterPublicKey: string;

  @IsBoolean()
  support: boolean;
}

export class OverrideDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @IsBoolean()
  verified: boolean;
}

export class UpdateConfigDto {
  @IsNumber()
  @IsInt()
  @Min(1)
  quorumThreshold: number;

  @IsNumber()
  @IsInt()
  @Min(1)
  minVoterWeight: number;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface ProjectVerificationDto {
  projectId: number;
  name: string;
  ownerPublicKey: string;
  status: VerificationStatus;
  votesFor: number;
  votesAgainst: number;
  registeredAt: number;
  resolvedAt: number;
  /** Percentage of quorum reached (0–100) */
  quorumProgress: number;
}

export interface VoteResultDto {
  projectId: number;
  voterPublicKey: string;
  weight: number;
  support: boolean;
  newStatus: VerificationStatus;
  votesFor: number;
  votesAgainst: number;
}

export interface RegistryConfigDto {
  quorumThreshold: number;
  weightMode: WeightMode;
  minVoterWeight: number;
}
