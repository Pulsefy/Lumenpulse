import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class BootstrapAccountRequestDto {
  @ApiProperty({
    description: 'Stellar testnet public key to fund (starts with G, 56 chars)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'publicKey must be a valid Stellar public key (starts with G, 56 base32 characters)',
  })
  publicKey: string;
}

export class BootstrapAccountResponseDto {
  @ApiProperty({
    description: 'Success status of the bootstrap request',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Message describing the result',
    example: 'Account funded successfully',
  })
  message: string;

  @ApiProperty({
    description: 'The public key that was funded',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  publicKey: string;
}
