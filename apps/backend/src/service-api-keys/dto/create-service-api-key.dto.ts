import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export const SERVICE_API_KEY_SCOPES = [
  'data:read',
  'data:write',
  'admin',
] as const;

export type ServiceApiKeyScope = (typeof SERVICE_API_KEY_SCOPES)[number];

export class CreateServiceApiKeyDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(SERVICE_API_KEY_SCOPES, { each: true })
  scopes: ServiceApiKeyScope[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
