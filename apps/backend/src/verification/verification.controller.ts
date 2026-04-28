import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VerificationService } from './verification.service';
import {
  CastVoteDto,
  OverrideDto,
  ProjectVerificationDto,
  RegisterProjectDto,
  UpdateConfigDto,
} from './dto/verification.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ProjectListQueryDto,
  ProjectListResponseDto,
} from './dto/project-list-query.dto';

@Controller('verification')
export class VerificationController {
  constructor(private readonly svc: VerificationService) {}

  @Get('config')
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard)
  updateConfig(@Body() dto: UpdateConfigDto) {
    return this.svc.updateConfig(dto);
  }

  @Get('projects')
  listProjects(
    @Query() query: ProjectListQueryDto,
  ): ProjectListResponseDto<ProjectVerificationDto> {
    return this.svc.listProjects(query);
  }

  @Get('projects/:id')
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProject(id);
  }

  @Get('projects/:id/verified')
  isVerified(@Param('id', ParseIntPipe) id: number) {
    return { projectId: id, verified: this.svc.isVerified(id) };
  }

  @Post('projects')
  @UseGuards(JwtAuthGuard)
  registerProject(@Body() dto: RegisterProjectDto) {
    return this.svc.registerProject(dto);
  }

  @Post('vote')
  castVote(@Body() dto: CastVoteDto) {
    return this.svc.castVote(dto);
  }

  @Post('override')
  @UseGuards(JwtAuthGuard)
  override(@Body() dto: OverrideDto) {
    return this.svc.overrideVerification(dto);
  }
}
