import { IsString, IsNotEmpty, Matches, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorGenerateResponseDto {
  @ApiProperty({
    description: 'OTPAuth URI for manual entry into authenticator apps',
    example: 'otpauth://totp/Lumenpulse:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Lumenpulse',
  })
  otpauthUri: string;

  @ApiProperty({
    description: 'Base64 encoded QR code data URL for scanning',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
  })
  qrCode: string;
}

export class TwoFactorEnableDto {
  @ApiProperty({
    description: '6-digit TOTP code from authenticator app',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  @Matches(/^\d{6}$/, {
    message: 'Token must be exactly 6 numeric digits',
  })
  token: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({
    description: 'User ID from the pending 2FA login step',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId: string;

  @ApiProperty({
    description: '6-digit TOTP code from authenticator app',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  @Matches(/^\d{6}$/, {
    message: 'Token must be exactly 6 numeric digits',
  })
  token: string;
}

export class TwoFactorDisableDto {
  @ApiProperty({
    description: '6-digit TOTP code from authenticator app to confirm disabling',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @IsNotEmpty({ message: 'Token is required' })
  @Matches(/^\d{6}$/, {
    message: 'Token must be exactly 6 numeric digits',
  })
  token: string;
}

export class TwoFactorPendingResponseDto {
  @ApiProperty({
    description: 'Indicates that 2FA verification is required to complete login',
    example: true,
  })
  requiresTwoFactor: true;

  @ApiProperty({
    description: 'User ID to use for the 2FA verification step',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userId: string;
}
