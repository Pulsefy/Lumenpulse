import { IsString, IsNotEmpty, MaxLength, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoundDto {
  @ApiProperty({
    description: 'Name of the round (max 32 characters for Symbol)',
    example: 'Round1',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  name: string;

  @ApiProperty({
    description: 'Stellar address of the token used for matching',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  })
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @ApiProperty({
    description: 'Unix timestamp representing start of round',
    example: 1774872000,
  })
  @IsInt()
  @Min(0)
  startTime: number;

  @ApiProperty({
    description: 'Unix timestamp representing end of round',
    example: 1777464000,
  })
  @IsInt()
  @Min(0)
  endTime: number;
}
