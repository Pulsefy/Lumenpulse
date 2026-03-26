import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkStellarAccountDto {
  @ApiProperty({
    description: 'Stellar public key (starts with G)',
    example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHF',
  })
  @IsString()
  @Matches(/^G[A-Z0-9]{55}$/, {
    message:
      'Invalid Stellar public key format. Must be a valid Ed25519 public key starting with G.',
  })
  publicKey: string;

  @ApiProperty({
    description: 'Optional label for the account',
    example: 'Trading Wallet',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  label?: string;
}
