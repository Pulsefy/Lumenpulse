import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CrowdfundService } from './crowdfund.service';
import { ContributeDto, CreateProjectDto } from './dto/crowdfund.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('crowdfund')
export class CrowdfundController {
  constructor(private readonly svc: CrowdfundService) {}

  // ── Projects ───────────────────────────────────────────────────────────────

  @Get('projects')
  listProjects() {
    return this.svc.listProjects();
  }

  @Get('projects/:id')
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProject(id);
  }

  @Post('projects')
  @UseGuards(JwtAuthGuard)
  createProject(@Body() dto: CreateProjectDto) {
    return this.svc.createProject(dto);
  }

  // ── Contributions ──────────────────────────────────────────────────────────

  @Post('contribute')
  contribute(@Body() dto: ContributeDto) {
    return this.svc.contribute(dto);
  }

  @Get('projects/:id/contributors')
  getContributors(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getContributors(id);
  }

  @Get('projects/:id/balance')
  getBalance(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProjectBalance(id);
  }

  @Get('projects/:id/my-contributions')
  @UseGuards(JwtAuthGuard)
  getMyContributions(
    @Param('id', ParseIntPipe) id: number,
    @Query('publicKey') publicKey: string,
  ) {
    return this.svc.getMyContributions(id, publicKey);
  }
}
