import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsString,
  Min,
} from 'class-validator';

/**
 * Request body for allocating a treasury budget and starting a vesting stream
 * for a beneficiary against the on-chain treasury contract.
 */
export class AllocateBudgetDto {
  @ApiProperty({
    description: 'Stellar address of the beneficiary receiving the stream',
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
    description: 'Stream start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  @IsInt()
  @Min(0)
  startTime: number;

  @ApiProperty({
    description: 'Stream duration in seconds. Must be > 0.',
    example: 2592000,
  })
  @IsInt()
  @Min(1)
  duration: number;
}
