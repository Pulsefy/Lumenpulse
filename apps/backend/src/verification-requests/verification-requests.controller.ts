import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import {
  CreateVerificationRequestDto,
  UpdateVerificationRequestStatusDto,
  VerificationRequestQueryDto,
  VerificationRequestResponseDto,
} from './dto/verification-request.dto';
import { VerificationRequestsService } from './verification-requests.service';

interface AuthenticatedRequest extends Request {
  user: { id: string; role: UserRole };
}

@ApiTags('verification-requests')
@ApiBearerAuth('JWT-auth')
@Controller('verification-requests')
@UseGuards(JwtAuthGuard)
export class VerificationRequestsController {
  constructor(private readonly service: VerificationRequestsService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a verification request for a contributor or project',
  })
  @ApiResponse({ status: 201, type: VerificationRequestResponseDto })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateVerificationRequestDto,
  ) {
    return this.service.create(req.user.id, dto);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'List verification requests submitted by the current user',
  })
  findMine(@Req() req: AuthenticatedRequest) {
    return this.service.findMine(req.user.id);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({
    summary: 'List verification requests for the reviewer queue',
  })
  findAll(@Query() query: VerificationRequestQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve a verification request and its current lifecycle state',
  })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.findOne(id, req.user.id, req.user.role);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({
    summary: 'Safely transition a verification request as a reviewer or admin',
  })
  transition(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateVerificationRequestStatusDto,
  ) {
    return this.service.transition(id, req.user.id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: "Cancel the current user's submitted verification request",
  })
  cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.cancel(id, req.user.id);
  }
}
