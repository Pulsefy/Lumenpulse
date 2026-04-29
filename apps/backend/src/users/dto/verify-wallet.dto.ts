import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetWalletChallengeDto {
  @ApiProperty({
    description: 'Stellar public key to verify',
    example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHF',
  })
  @IsString()
  @IsNotEmpty()
  publicKey: string;
}

export class VerifyWalletDto {
  @ApiProperty({
    description: 'Stellar public key to verify',
    example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHF',
  })
  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @ApiProperty({
    description: 'Signed challenge transaction in XDR format',
    example: 'AAAA...',
  })
  @IsString()
  @IsNotEmpty()
  signedChallenge: string;
}

export class WalletChallengeResponseDto {
  @ApiProperty({
    description: 'Challenge transaction in XDR format',
  })
  challenge: string;

  @ApiProperty({
    description: 'Nonce used in the challenge',
  })
  nonce: string;

  @ApiProperty({
    description: 'Time in seconds until challenge expires',
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Public key that should sign the challenge',
  })
  publicKey: string;
}

export class WalletVerificationResponseDto {
  @ApiProperty({
    description: 'Whether verification was successful',
  })
  verified: boolean;

  @ApiProperty({
    description: 'Public key that was verified',
  })
  publicKey: string;

  @ApiProperty({
    description: 'Message describing the result',
  })
  message: string;
}
