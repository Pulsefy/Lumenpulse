import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateRoundDto {
  @ApiProperty({ example: 'Q3 2025 Matching Round' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 1000000,
    description: 'Total matching funds in stroops',
  })
  @IsNumber()
  @Min(1)
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
  @IsNotEmpty()
  projectAddress: string;
}

export class RoundResponseDto {
  roundId: string;
  txHash: string;
  status: string;
  createdAt: Date;
}
