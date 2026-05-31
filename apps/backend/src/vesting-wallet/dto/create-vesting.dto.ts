import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsString,
  Min,
} from 'class-validator';

export class CreateVestingDto {
  @ApiProperty({
    description:
      'Stellar address of the beneficiary receiving the vesting schedule',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @ApiProperty({
    description:
      'Total amount to allocate, in the token base unit (stroops). ' +
      'Expressed as a string to safely represent i128 values. Must be > 0.',
    example: '1000000000',
  })
  @IsNumberString({ no_symbols: true })
  amount: string;

  @ApiProperty({
    description: 'Vesting start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  @IsInt()
  @Min(0)
  startTime: number;

  @ApiProperty({
    description: 'Vesting duration in seconds. Must be > 0.',
    example: 2592000,
  })
  @IsInt()
  @Min(1)
  duration: number;
}

export class CreateVestingWithMilestoneDto {
  @ApiProperty({
    description:
      'Stellar address of the beneficiary receiving the vesting schedule',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @ApiProperty({
    description:
      'Total amount to allocate, in the token base unit (stroops). ' +
      'Expressed as a string to safely represent i128 values. Must be > 0.',
    example: '1000000000',
  })
  @IsNumberString({ no_symbols: true })
  amount: string;

  @ApiProperty({
    description: 'Vesting start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  @IsInt()
  @Min(0)
  startTime: number;

  @ApiProperty({
    description: 'Vesting duration in seconds. Must be > 0.',
    example: 2592000,
  })
  @IsInt()
  @Min(1)
  duration: number;

  @ApiProperty({
    description: 'Address of the crowdfund vault contract',
    example: 'CABC...',
  })
  @IsString()
  @IsNotEmpty()
  vaultContract: string;

  @ApiProperty({
    description: 'Project ID in the crowdfund registry',
    example: 1,
  })
  @IsInt()
  @Min(1)
  projectId: number;

  @ApiProperty({
    description: 'Milestone ID in the crowdfund vault roadmap',
    example: 0,
  })
  @IsInt()
  @Min(0)
  milestoneId: number;
}
