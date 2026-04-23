import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateStellarAccountLabelDto {
  @ApiProperty({
    description: 'New label for the account',
    example: 'Savings Wallet',
  })
  @IsString()
  @MaxLength(100)
  label: string;
}
