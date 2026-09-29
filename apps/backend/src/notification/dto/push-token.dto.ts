import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PushTokenPlatform } from '../push-token.entity';

export class RegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  @IsEnum(PushTokenPlatform)
  platform: PushTokenPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

export class DeregisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;
}
