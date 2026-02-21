import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetChallengeDto {
  @ApiProperty({
    description: 'Stellar public key (starts with G)',
    example: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
  })
  @IsString()
  @IsNotEmpty({ message: 'Public key is required' })
  @Matches(/^G[A-Z0-9]{55}$/, {
    message:
      'Invalid Stellar public key format. Must start with G and be 56 characters long',
  })
  publicKey: string;
}

export class VerifyChallengeDto {
  @ApiProperty({
    description: 'Stellar public key',
    example: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
  })
  @IsString()
  @IsNotEmpty({ message: 'Public key is required' })
  @Matches(/^G[A-Z0-9]{55}$/, {
    message: 'Invalid Stellar public key format',
  })
  publicKey: string;

  @ApiProperty({
    description: 'Signed challenge transaction in XDR format',
    example: 'AAAAAgAAAAD...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Signed challenge is required' })
  signedChallenge: string;
}
