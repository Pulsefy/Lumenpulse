import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { WebhookSignatureAlgorithm } from '../webhook.types';

export class CreateWebhookProviderDto {
  @ApiProperty({
    description: 'Unique provider identifier',
    example: 'data-processing-service',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Signature algorithm',
    enum: WebhookSignatureAlgorithm,
    example: WebhookSignatureAlgorithm.HMAC_SHA256,
  })
  @IsEnum(WebhookSignatureAlgorithm)
  algorithm: WebhookSignatureAlgorithm;

  @ApiProperty({
    description: 'Secret key for HMAC algorithms',
    required: false,
  })
  @IsString()
  @IsOptional()
  secret?: string;

  @ApiProperty({
    description: 'Public key for RSA/Ed25519 (base64 encoded)',
    required: false,
  })
  @IsString()
  @IsOptional()
  publicKey?: string;

  @ApiProperty({
    description: 'Whether this provider is enabled',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({
    description: 'Timestamp tolerance in milliseconds for replay protection',
    required: false,
    example: 300000,
  })
  @IsOptional()
  timestampToleranceMs?: number;

  @ApiProperty({
    description: 'Expected signature header name',
    required: false,
    example: 'X-Webhook-Signature',
  })
  @IsString()
  @IsOptional()
  signatureHeader?: string;

  @ApiProperty({
    description: 'Expected timestamp header name',
    required: false,
    example: 'X-Webhook-Timestamp',
  })
  @IsString()
  @IsOptional()
  timestampHeader?: string;

  @ApiProperty({
    description: 'Allowed IP addresses',
    required: false,
    example: ['192.168.1.1', '10.0.0.1'],
  })
  @IsString({ each: true })
  @IsOptional()
  allowedIps?: string[];
}

export class UpdateWebhookProviderDto {
  @ApiProperty({
    description: 'Whether this provider is enabled',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({
    description: 'Secret key for HMAC algorithms',
    required: false,
  })
  @IsString()
  @IsOptional()
  secret?: string;

  @ApiProperty({
    description: 'Public key for RSA/Ed25519 (base64 encoded)',
    required: false,
  })
  @IsString()
  @IsOptional()
  publicKey?: string;

  @ApiProperty({
    description: 'Timestamp tolerance in milliseconds',
    required: false,
  })
  @IsOptional()
  timestampToleranceMs?: number;
}

export class WebhookProviderResponseDto {
  @ApiProperty({ description: 'Provider name' })
  name: string;

  @ApiProperty({ enum: WebhookSignatureAlgorithm })
  algorithm: WebhookSignatureAlgorithm;

  @ApiProperty({ description: 'Whether provider is enabled' })
  enabled: boolean;

  @ApiProperty({
    description: 'Timestamp tolerance in milliseconds',
    required: false,
  })
  timestampToleranceMs?: number;

  @ApiProperty({ description: 'Signature header name' })
  signatureHeader?: string;

  @ApiProperty({ description: 'Timestamp header name' })
  timestampHeader?: string;

  @ApiProperty({ description: 'Has secret configured' })
  hasSecret: boolean;

  @ApiProperty({ description: 'Has public key configured' })
  hasPublicKey: boolean;
}
