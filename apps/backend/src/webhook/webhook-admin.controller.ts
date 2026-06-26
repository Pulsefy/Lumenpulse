import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { WebhookVerificationService } from './webhook-verification.service';
import {
  WebhookSignatureAlgorithm,
  WebhookProviderConfig,
} from './webhook.types';
import {
  CreateWebhookProviderDto,
  UpdateWebhookProviderDto,
  WebhookProviderResponseDto,
} from './dto/webhook-provider.dto';

@ApiTags('webhook-admin')
@Controller('webhooks/admin/providers')
export class WebhookAdminController {
  constructor(
    private readonly verificationService: WebhookVerificationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all registered webhook providers',
    description: 'Returns information about all configured webhook providers',
  })
  @ApiResponse({
    status: 200,
    description: 'List of webhook providers',
    type: [WebhookProviderResponseDto],
  })
  getAllProviders(): WebhookProviderResponseDto[] {
    const providers = this.verificationService.getRegisteredProviders();
    const result: WebhookProviderResponseDto[] = [];

    for (const name of providers) {
      const info = this.verificationService.getProviderInfo(name);
      if (!info) continue;

      result.push({
        name: info.name!,
        algorithm: info.algorithm!,
        enabled: info.enabled!,
        timestampToleranceMs: info.timestampToleranceMs,
        signatureHeader: info.signatureHeader,
        timestampHeader: info.timestampHeader,
        hasSecret: 'secret' in info && info.secret !== undefined,
        hasPublicKey: 'publicKey' in info && info.publicKey !== undefined,
      });
    }

    return result;
  }

  @Get(':name')
  @ApiOperation({
    summary: 'Get webhook provider details',
    description: 'Returns configuration details for a specific provider',
  })
  @ApiParam({ name: 'name', description: 'Provider name' })
  @ApiResponse({
    status: 200,
    description: 'Provider details',
    type: WebhookProviderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  getProvider(@Param('name') name: string): WebhookProviderResponseDto {
    const info = this.verificationService.getProviderInfo(name);
    if (!info) {
      throw new NotFoundException(`Provider '${name}' not found`);
    }

    return {
      name: info.name!,
      algorithm: info.algorithm!,
      enabled: info.enabled!,
      timestampToleranceMs: info.timestampToleranceMs,
      signatureHeader: info.signatureHeader,
      timestampHeader: info.timestampHeader,
      hasSecret: 'secret' in info && info.secret !== undefined,
      hasPublicKey: 'publicKey' in info && info.publicKey !== undefined,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new webhook provider',
    description: 'Adds a new webhook provider configuration at runtime',
  })
  @ApiResponse({
    status: 201,
    description: 'Provider created successfully',
    type: WebhookProviderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid provider configuration' })
  createProvider(
    @Body() dto: CreateWebhookProviderDto,
  ): WebhookProviderResponseDto {
    // Validate that either secret or publicKey is provided
    if (
      !dto.secret &&
      !dto.publicKey &&
      (dto.algorithm === WebhookSignatureAlgorithm.HMAC_SHA256 ||
        dto.algorithm === WebhookSignatureAlgorithm.HMAC_SHA512)
    ) {
      throw new BadRequestException('Secret is required for HMAC algorithms');
    }

    if (
      !dto.publicKey &&
      (dto.algorithm === WebhookSignatureAlgorithm.RSA_SHA256 ||
        dto.algorithm === WebhookSignatureAlgorithm.ED25519)
    ) {
      throw new BadRequestException(
        'Public key is required for RSA/Ed25519 algorithms',
      );
    }

    this.verificationService.registerProvider({
      name: dto.name,
      algorithm: dto.algorithm,
      secret: dto.secret,
      publicKey: dto.publicKey,
      enabled: dto.enabled ?? true,
      timestampToleranceMs: dto.timestampToleranceMs,
      signatureHeader: dto.signatureHeader,
      timestampHeader: dto.timestampHeader,
      allowedIps: dto.allowedIps,
    });

    const info = this.verificationService.getProviderInfo(dto.name);
    if (!info) {
      throw new BadRequestException('Failed to create provider');
    }

    return {
      name: info.name!,
      algorithm: info.algorithm!,
      enabled: info.enabled!,
      timestampToleranceMs: info.timestampToleranceMs,
      signatureHeader: info.signatureHeader,
      timestampHeader: info.timestampHeader,
      hasSecret: dto.secret !== undefined,
      hasPublicKey: dto.publicKey !== undefined,
    };
  }

  @Put(':name')
  @ApiOperation({
    summary: 'Update webhook provider configuration',
    description: 'Updates an existing webhook provider configuration',
  })
  @ApiParam({ name: 'name', description: 'Provider name' })
  @ApiResponse({
    status: 200,
    description: 'Provider updated successfully',
    type: WebhookProviderResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  updateProvider(
    @Param('name') name: string,
    @Body() dto: UpdateWebhookProviderDto,
  ): WebhookProviderResponseDto {
    const existingInfo = this.verificationService.getProviderInfo(name);
    if (!existingInfo) {
      throw new NotFoundException(`Provider '${name}' not found`);
    }

    // Re-register with updated values
    this.verificationService.registerProvider({
      name,
      algorithm: existingInfo.algorithm!,
      secret: dto.secret ?? existingInfo.secret,
      publicKey: dto.publicKey ?? existingInfo.publicKey,
      enabled: dto.enabled ?? existingInfo.enabled!,
      timestampToleranceMs:
        dto.timestampToleranceMs ?? existingInfo.timestampToleranceMs,
      signatureHeader: existingInfo.signatureHeader,
      timestampHeader: existingInfo.timestampHeader,
      allowedIps: existingInfo.allowedIps,
    });

    const updatedInfo = this.verificationService.getProviderInfo(name);
    if (!updatedInfo) {
      throw new NotFoundException(`Provider '${name}' not found after update`);
    }

    return {
      name: updatedInfo.name!,
      algorithm: updatedInfo.algorithm!,
      enabled: updatedInfo.enabled!,
      timestampToleranceMs: updatedInfo.timestampToleranceMs,
      signatureHeader: updatedInfo.signatureHeader,
      timestampHeader: updatedInfo.timestampHeader,
      hasSecret: dto.secret !== undefined,
      hasPublicKey: dto.publicKey !== undefined,
    };
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a webhook provider',
    description: 'Removes a webhook provider configuration',
  })
  @ApiParam({ name: 'name', description: 'Provider name' })
  @ApiResponse({ status: 204, description: 'Provider removed successfully' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  deleteProvider(@Param('name') name: string): void {
    const info = this.verificationService.getProviderInfo(name);
    if (!info) {
      throw new NotFoundException(`Provider '${name}' not found`);
    }

    // Note: This is a runtime-only removal. For persistent storage, implement a database.
    const config: WebhookProviderConfig = {
      name: info.name!,
      algorithm: info.algorithm!,
      secret: info.secret,
      publicKey: info.publicKey,
      enabled: false,
      timestampToleranceMs: info.timestampToleranceMs,
      signatureHeader: info.signatureHeader,
      timestampHeader: info.timestampHeader,
      allowedIps: info.allowedIps,
    };
    this.verificationService.registerProvider(config);
  }
}
