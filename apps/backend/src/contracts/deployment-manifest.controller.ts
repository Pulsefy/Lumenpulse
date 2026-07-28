import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractAdminGuard } from '../common/guards/contract-admin.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { DeploymentManifestService } from './deployment-manifest.service';
import {
  CreateDeploymentManifestDto,
  UpdateDeploymentManifestDto,
  QueryDeploymentManifestDto,
  DeploymentManifestResponseDto,
  DeploymentManifestListResponseDto,
} from './dto/deployment-manifest.dto';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';
import { Request as ExpressRequest } from 'express';

interface RequestUser {
  id: string;
  role: UserRole;
  email?: string;
}

interface AuthenticatedRequest extends ExpressRequest {
  user?: RequestUser;
}

@ApiTags('contracts')
@Controller({ path: 'contracts/manifests', version: '1' })
@UsePipes(CustomValidationPipe)
export class DeploymentManifestController {
  constructor(private readonly manifestService: DeploymentManifestService) {}

  @Get('active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get active contract deployment manifest',
    description:
      'Returns the active contract deployment manifest recording contract identifiers and environment metadata ' +
      'for the specified network environment (defaults to testnet). Safe for frontend and ops tooling.',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    example: 'testnet',
    description: 'Network environment identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Active deployment manifest retrieved successfully',
    type: DeploymentManifestResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No active deployment manifest found',
  })
  async getActiveManifest(
    @Query('environment') environment?: string,
  ): Promise<DeploymentManifestResponseDto> {
    return this.manifestService.findActive(environment || 'testnet');
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get deployment manifest history',
    description:
      'Returns historical contract deployment entries and previous testnet/environment changes for inspection by clients and operators.',
  })
  @ApiResponse({
    status: 200,
    description: 'Deployment manifest history retrieved successfully',
    type: DeploymentManifestListResponseDto,
  })
  async getManifestHistory(
    @Query() query: QueryDeploymentManifestDto,
  ): Promise<DeploymentManifestListResponseDto> {
    return this.manifestService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get contract deployment manifest by ID',
    description:
      'Returns a specific contract deployment manifest record by ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Manifest record UUID',
    example: '3a2b1c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @ApiResponse({
    status: 200,
    description: 'Deployment manifest retrieved successfully',
    type: DeploymentManifestResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Manifest record not found',
  })
  async getManifestById(
    @Param('id') id: string,
  ): Promise<DeploymentManifestResponseDto> {
    return this.manifestService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a new contract deployment manifest record (admin only)',
    description:
      'Stores a new deployment manifest recording contract IDs and environment metadata. Automatically sets active manifest status.',
  })
  @ApiResponse({
    status: 201,
    description: 'Deployment manifest created successfully',
    type: DeploymentManifestResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async createManifest(
    @Body() dto: CreateDeploymentManifestDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DeploymentManifestResponseDto> {
    const actorId = req.user?.id;
    return this.manifestService.create(dto, actorId);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update contract deployment manifest record (admin only)',
    description:
      'Updates contract identifiers, metadata, or active status of a deployment manifest record.',
  })
  @ApiParam({
    name: 'id',
    description: 'Manifest record UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'Deployment manifest updated successfully',
    type: DeploymentManifestResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 404, description: 'Manifest record not found' })
  async updateManifest(
    @Param('id') id: string,
    @Body() dto: UpdateDeploymentManifestDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<DeploymentManifestResponseDto> {
    const actorId = req.user?.id;
    return this.manifestService.update(id, dto, actorId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete contract deployment manifest record (admin only)',
    description: 'Deletes a deployment manifest entry by ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Manifest record UUID',
  })
  @ApiResponse({
    status: 24,
    description: 'Deployment manifest deleted successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 404, description: 'Manifest record not found' })
  async deleteManifest(@Param('id') id: string): Promise<void> {
    return this.manifestService.remove(id);
  }
}
