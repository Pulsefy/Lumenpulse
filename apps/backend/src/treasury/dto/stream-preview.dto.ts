import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request body for the treasury stream preview endpoint.
 * All inputs are read-only — no transaction is submitted.
 */
export class StreamPreviewDto {
  @ApiProperty({
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @ApiPropertyOptional({
    description:
      'Unix timestamp (seconds) to evaluate the stream at. ' +
      'Defaults to the current server time when omitted.',
    example: 1735689600,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  atTime?: number;
}

/**
 * Read-only preview of a treasury stream's unlocked, claimed, and remaining
 * amounts at a given point in time, without submitting any transaction.
 */
export class StreamPreviewResponseDto {
  @ApiProperty({
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  beneficiary: string;

  @ApiProperty({
    description: 'Total amount allocated to the stream (stroops)',
    example: '1000000000',
  })
  totalAmount: string;

  @ApiProperty({
    description: 'Amount already claimed from the stream (stroops)',
    example: '250000000',
  })
  claimedAmount: string;

  @ApiProperty({
    description:
      'Amount currently unlocked and claimable at `atTime` (stroops). ' +
      'Computed using the same linear-vesting formula as the on-chain contract.',
    example: '100000000',
  })
  unlockedAmount: string;

  @ApiProperty({
    description: 'Amount not yet claimed: totalAmount - claimedAmount (stroops)',
    example: '750000000',
  })
  remainingAmount: string;

  @ApiProperty({
    description: 'Stream start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  startTime: number;

  @ApiProperty({
    description: 'Stream duration in seconds',
    example: 2592000,
  })
  duration: number;

  @ApiProperty({
    description:
      'Unix timestamp (seconds) at which the preview was calculated. ' +
      'Equal to the `atTime` input when provided, otherwise the server clock.',
    example: 1735776000,
  })
  previewAt: number;

  @ApiProperty({
    description:
      'Whether the stream is currently active (started and not yet fully elapsed).',
    example: true,
  })
  isActive: boolean;
}
