import { ApiProperty } from '@nestjs/swagger';
import { SERVICE_API_KEY_SCOPES } from './create-service-api-key.dto';

export class ServiceApiKeyResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  consumerId: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ description: 'Short non-secret key prefix' })
  keyPrefix: string;

  @ApiProperty({ enum: SERVICE_API_KEY_SCOPES, isArray: true })
  scopes: string[];

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ nullable: true })
  revokedAt: Date | null;

  @ApiProperty({ nullable: true })
  revokedBy: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  lastUsedAt: Date | null;
}

export class IssuedServiceApiKeyResponseDto {
  @ApiProperty({
    description:
      'New API key secret. It is returned only when issuing or rotating a key.',
  })
  key: string;

  @ApiProperty({ type: ServiceApiKeyResponseDto })
  apiKey: ServiceApiKeyResponseDto;
}
