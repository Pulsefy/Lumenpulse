import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class TwoFactorAuthCodeDto {
  @ApiProperty({ example: '123456', description: 'The 6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  twoFactorAuthenticationCode: string;
}

export class VerifyTwoFactorAuthDto {
  @ApiProperty({ example: '123456', description: 'The 6-digit TOTP code' })
  @IsString()
  @IsNotEmpty()
  twoFactorAuthenticationCode: string;

  @ApiProperty({
    example: 'eyJhbGci...',
    description: 'The temporary token received from login',
  })
  @IsString()
  @IsNotEmpty()
  tempToken: string;
}
