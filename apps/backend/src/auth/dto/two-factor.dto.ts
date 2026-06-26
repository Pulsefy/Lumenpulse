import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorGenerateDto {
  @ApiProperty({
    description: 'User email for TOTP setup',
    example: 'user@example.com',
  })
  @IsString()
  @IsNotEmpty({ message: 'Email is required' })
  email: string;
}

export class TwoFactorEnableDto {
  @ApiProperty({
    description: 'TOTP code from authenticator app',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'TOTP code is required' })
  @Matches(/^\d{6}$/, {
    message: 'TOTP code must be 6 digits',
  })
  token: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
  })
  @IsString()
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;

  @ApiProperty({
    description: 'TOTP code from authenticator app',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'TOTP code is required' })
  @Matches(/^\d{6}$/, {
    message: 'TOTP code must be 6 digits',
  })
  token: string;
}

export class TwoFactorDisableDto {
  @ApiProperty({
    description: 'TOTP code to disable 2FA',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'TOTP code is required' })
  @Matches(/^\d{6}$/, {
    message: 'TOTP code must be 6 digits',
  })
  token: string;
}
