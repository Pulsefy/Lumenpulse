import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { CreateServiceApiKeyDto } from './dto/create-service-api-key.dto';
import {
  IssuedServiceApiKeyResponseDto,
  ServiceApiKeyResponseDto,
} from './dto/service-api-key-response.dto';
import { ServiceApiKeysService } from './service-api-keys.service';

interface AuthenticatedRequest extends Request {
  user: { id: string };
}

@ApiTags('service-api-keys')
@ApiBearerAuth('JWT-auth')
@Controller('service-consumers/:consumerId/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ServiceApiKeysController {
  constructor(private readonly service: ServiceApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for a service consumer' })
  @ApiOkResponse({ type: [ServiceApiKeyResponseDto] })
  list(@Param('consumerId') consumerId: string) {
    return this.service.list(consumerId);
  }

  @Post()
  @ApiOperation({
    summary: 'Issue a scoped API key; the secret is returned only once',
  })
  @Header('Cache-Control', 'no-store')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiCreatedResponse({ type: IssuedServiceApiKeyResponseDto })
  issue(
    @Param('consumerId') consumerId: string,
    @Body() dto: CreateServiceApiKeyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.issue(consumerId, dto, request.user.id);
  }

  @Post(':id/rotate')
  @ApiOperation({
    summary: 'Issue a replacement key while leaving the current key active',
  })
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ type: IssuedServiceApiKeyResponseDto })
  rotate(
    @Param('consumerId') consumerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.rotate(consumerId, id, request.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a service API key immediately' })
  @ApiOkResponse({ type: ServiceApiKeyResponseDto })
  revoke(
    @Param('consumerId') consumerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.revoke(consumerId, id, request.user.id);
  }
}
