import { ApiProperty } from '@nestjs/swagger';

/**
 * Stream state for a single beneficiary, as stored by the treasury contract.
 * Amounts are returned as strings to safely represent i128 values.
 */
export class StreamStateDto {
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
    description: 'Amount currently unlocked and claimable (stroops)',
    example: '100000000',
  })
  unlockedAmount: string;

  @ApiProperty({
    description:
      'Amount not yet claimed: totalAmount - claimedAmount (stroops)',
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
}

/**
 * Result of submitting an allocate-budget transaction to the treasury contract.
 */
export class AllocateBudgetResponseDto {
  @ApiProperty({
    description: 'Hash of the submitted Soroban transaction',
    example: 'a1b2c3d4e5f6...',
  })
  transactionHash: string;

  @ApiProperty({
    description: 'On-chain status of the transaction',
    example: 'SUCCESS',
    enum: ['SUCCESS'],
  })
  status: string;

  @ApiProperty({
    description: 'Ledger sequence in which the transaction was applied',
    example: 1234567,
    required: false,
  })
  ledger?: number;

  @ApiProperty({
    description: 'The stream that was created by the allocation',
    type: StreamStateDto,
  })
  stream: StreamStateDto;
}
