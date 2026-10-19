import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { JWT_SECURITY_SCHEME } from '../openapi/openapi.constants';
import { SupportModeService } from './support-mode.service';

export class StartSupportSessionDto {
  @ApiProperty({ format: 'uuid', description: 'User to view as' })
  @IsUUID()
  subjectId: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class StartSupportSessionResponseDto {
  @ApiProperty({ description: 'Read-only access token, valid 15 minutes' })
  accessToken: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Support session summary (id, actor, subject, expiry, ...)',
  })
  session: Record<string, unknown>;
}

type AdminRequest = ExpressRequest & { user: { id: string } };

@ApiTags('admin-support')
@ApiBearerAuth(JWT_SECURITY_SCHEME)
@Controller('admin/support/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SupportModeController {
  constructor(private readonly supportMode: SupportModeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: StartSupportSessionResponseDto })
  @ApiOperation({
    summary:
      'Start a read-only support session as a user (returns a 15 minute token)',
  })
  start(@Body() dto: StartSupportSessionDto, @Request() req: AdminRequest) {
    return this.supportMode.start(req.user, dto.subjectId, dto.reason, req.ip);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a support session early' })
  end(@Param('id', ParseUUIDPipe) id: string, @Request() req: AdminRequest) {
    return this.supportMode.end(id, req.user.id, req.ip);
  }

  @Get()
  @ApiOperation({ summary: 'List support sessions' })
  list(
    @Query('subjectId') subjectId?: string,
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supportMode.list(
      { subjectId, actorId },
      limit ? Number(limit) || 50 : 50,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one support session with its accessed endpoints',
  })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportMode.get(id);
  }
}
