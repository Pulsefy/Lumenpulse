import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const GITHUB_HANDLE_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const GITHUB_HANDLE_MESSAGE =
  'githubHandle must be a valid GitHub username (1-39 alphanumeric or hyphen characters, no leading/trailing hyphens)';

export class RegisterContributorDto {
  @ApiProperty({
    example: 'GABC1234...',
    description: 'Stellar public key of the contributor (G...)',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    example: 'octocat',
    description: 'GitHub username of the contributor',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(GITHUB_HANDLE_PATTERN, { message: GITHUB_HANDLE_MESSAGE })
  githubHandle: string;
}

export class RegisterWithSigDto {
  @ApiProperty({
    example: 'GABC1234...',
    description: 'Stellar public key of the contributor (G...)',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    example: 'octocat',
    description: 'GitHub username of the contributor',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(GITHUB_HANDLE_PATTERN, { message: GITHUB_HANDLE_MESSAGE })
  githubHandle: string;

  @ApiProperty({
    description:
      'Base64-encoded SorobanAuthorizationEntry signed by the contributor off-chain. ' +
      'Must authorize register_contributor_with_sig(github_handle, address, nonce).',
    example: 'AAAAAQAAAA...',
  })
  @IsString()
  @IsNotEmpty()
  signedAuthEntryXdr: string;

  @ApiPropertyOptional({
    description:
      'Hex-encoded raw Ed25519 signature bytes to pass as the contract `signature` parameter. ' +
      'Defaults to 64 zero bytes when omitted (the auth entry is the real proof).',
    example: 'deadbeef...',
  })
  @IsString()
  @IsOptional()
  signatureHex?: string;
}

export class ContributorResponseDto {
  @ApiProperty({ example: 'GABC1234...' })
  address: string;

  @ApiProperty({ example: 'octocat' })
  githubHandle: string;

  @ApiProperty({ example: 42 })
  reputationScore: number;

  @ApiProperty({ enum: ['Novice', 'Builder', 'Architect', 'Core'], example: 'Builder' })
  tier: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  registeredAt: string;
}

export class ReputationResponseDto {
  @ApiProperty({ example: 'GABC1234...' })
  address: string;

  @ApiProperty({ example: 42 })
  reputationScore: number;

  @ApiProperty({ enum: ['Novice', 'Builder', 'Architect', 'Core'], example: 'Builder' })
  tier: string;
}

export class RegistrationXdrResponseDto {
  @ApiProperty({
    description:
      'Base64-encoded unsigned transaction XDR. In mock mode this is a placeholder string; ' +
      'in real mode sign this with the contributor wallet and submit via a Stellar-compatible client.',
    example: 'AAAAAQAAAA...',
  })
  unsignedXdr: string;

  @ApiProperty({
    description: 'Network passphrase required when signing the transaction.',
    example: 'Test SDF Network ; September 2015',
  })
  networkPassphrase: string;
}

export class SubmitResponseDto {
  @ApiProperty({ example: 'abc123...' })
  transactionHash: string;

  @ApiProperty({ enum: ['SUCCESS', 'PENDING', 'ERROR'], example: 'SUCCESS' })
  status: string;

  @ApiPropertyOptional({ example: 50123456 })
  ledger?: number;
}

export class NonceResponseDto {
  @ApiProperty({ example: 'GABC1234...' })
  address: string;

  @ApiProperty({
    description:
      'Current registration nonce for the address. Include this value in the ' +
      'SorobanAuthorizationEntry scope when signing register_contributor_with_sig.',
    example: 0,
  })
  nonce: number;
}
