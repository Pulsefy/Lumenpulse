import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min, IsOptional } from 'class-validator';
import {
  IsStellarAddress,
  IsStroopsAmount,
} from '../../common/validators/stellar.validators';
import { Type } from 'class-transformer';

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
  @IsNotEmpty({ message: 'beneficiary is required' })
  @IsStellarAddress({
    message: 'beneficiary must be a valid Stellar address (G...)',
  })
  beneficiary: string;

  @ApiProperty({
    description:
      'Total amount to allocate, in the token base unit (stroops). ' +
      'Expressed as a string to safely represent i128 values. Must be > 0.',
    example: '1000000000',
  })
  @IsString()
  @IsNotEmpty({ message: 'amount is required' })
  @IsStroopsAmount({
    message: 'amount must be a positive integer string (stroops)',
  })
  amount: string;

  @ApiProperty({
    description: 'Stream start time as a Unix timestamp in seconds',
    example: 1735689600,
  })
  @Type(() => Number)
  @IsInt({ message: 'startTime must be an integer' })
  @Min(0, { message: 'startTime must be at least 0 (current time or future)' })
  startTime: number;

  @ApiProperty({
    description: 'Stream duration in seconds. Must be > 0.',
    example: 2592000,
  })
  @Type(() => Number)
  @IsInt({ message: 'duration must be an integer' })
  @Min(1, { message: 'duration must be at least 1 second' })
  duration: number;

  @ApiProperty({
    description: 'Optional token address for the stream',
    example: 'CAS3J7X7Y5...',
    required: false,
  })
  @IsString()
  @IsOptional()
  tokenAddress?: string;
}
