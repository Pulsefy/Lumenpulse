import { ApiProperty } from '@nestjs/swagger';

export class VestingDataDto {
  @ApiProperty({
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  beneficiary: string;

  @ApiProperty({
    description: 'Total amount allocated to the schedule (stroops)',
    example: '1000000000',
  })
  totalAmount: string;

  @ApiProperty({
    description: 'Amount already claimed (stroops)',
    example: '250000000',
  })
  claimedAmount: string;

  @ApiProperty({
    description: 'Amount currently claimable (stroops)',
    example: '100000000',
  })
  claimableAmount: string;

  @ApiProperty({
    description:
      'Amount not yet claimed: totalAmount - claimedAmount (stroops)',
    example: '750000000',
  })
  remainingAmount: string;

  @ApiProperty({
    description: 'Vesting start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  startTime: number;

  @ApiProperty({
    description: 'Vesting duration in seconds',
    example: 2592000,
  })
  duration: number;

  @ApiProperty({
    description: 'Whether this schedule is gated by an external milestone',
    example: false,
  })
  hasMilestoneRequirement: boolean;

  @ApiProperty({
    description:
      'Address of the linked crowdfund vault contract, when applicable',
    example: 'CABC...',
    nullable: true,
  })
  vaultContract: string | null;

  @ApiProperty({
    description: 'Project ID in the crowdfund registry, when applicable',
    example: 1,
    nullable: true,
  })
  projectId: number | null;

  @ApiProperty({
    description: 'Milestone ID in the crowdfund vault roadmap, when applicable',
    example: 0,
    nullable: true,
  })
  milestoneId: number | null;
}

export class CreateVestingResponseDto {
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
    description: 'The vesting schedule that was created',
    type: VestingDataDto,
  })
  vesting: VestingDataDto;
}

export class ClaimablePreviewDto {
  @ApiProperty({
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  beneficiary: string;

  @ApiProperty({
    description: 'Total amount allocated to the schedule (stroops)',
    example: '1000000000',
  })
  totalAmount: string;

  @ApiProperty({
    description: 'Amount already claimed from the schedule (stroops)',
    example: '250000000',
  })
  claimedAmount: string;

  @ApiProperty({
    description:
      'Amount currently claimable (stroops). Fast read-only preview.',
    example: '100000000',
  })
  claimableAmount: string;

  @ApiProperty({
    description:
      'Amount not yet claimed: totalAmount - claimedAmount (stroops)',
    example: '750000000',
  })
  remainingAmount: string;

  @ApiProperty({
    description: 'Vesting start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  startTime: number;

  @ApiProperty({
    description: 'Vesting duration in seconds',
    example: 2592000,
  })
  duration: number;
}
