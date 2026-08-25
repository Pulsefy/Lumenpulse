import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStellarAddress } from '../../common/validators/stellar.validators';

export class CreateRoundDto {
  @ApiProperty({ example: 'Q3 2025 Matching Round' })
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  name: string;

  @ApiProperty({
    example: 1000000,
    description: 'Total matching funds in stroops',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'matchingFunds must be a number' })
  @Min(1, { message: 'matchingFunds must be at least 1 stroop' })
  matchingFunds: number;

  @ApiPropertyOptional({ example: 'Optional round description' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ApproveProjectDto {
  @ApiProperty({
    example: 'GABC...XYZ',
    description: 'Stellar project address',
  })
  @IsString()
  @IsNotEmpty({ message: 'projectAddress is required' })
  @IsStellarAddress({
    message: 'projectAddress must be a valid Stellar address (G...)',
  })
  projectAddress: string;
}

export class RoundResponseDto {
  roundId: string;
  txHash: string;
  status: string;
  createdAt: Date;
}
