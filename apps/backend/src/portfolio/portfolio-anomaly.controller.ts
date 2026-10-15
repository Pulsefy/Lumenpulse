import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import {
  CreatePortfolioAnomalyDto,
  PortfolioAnomalyResponseDto,
  PortfolioAnomaliesListResponseDto,
  ReviewPortfolioAnomalyDto,
} from './dto/portfolio-anomaly.dto';
import { PortfolioAnomalyService } from './portfolio-anomaly.service';
import { PortfolioAnomaly } from './entities/portfolio-anomaly.entity';

interface RequestWithUser extends Request {
  user: {
    id: string;
    role?: string;
  };
}

@ApiTags('portfolio anomalies')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('portfolio/anomalies')
export class PortfolioAnomalyController {
  constructor(
    private readonly portfolioAnomalyService: PortfolioAnomalyService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({ summary: 'Create a portfolio anomaly record' })
  @ApiResponse({
    status: 201,
    description: 'Anomaly created',
    type: PortfolioAnomalyResponseDto,
  })
  async createAnomaly(
    @Body() dto: CreatePortfolioAnomalyDto,
  ): Promise<PortfolioAnomalyResponseDto> {
    const anomaly = await this.portfolioAnomalyService.createAnomaly(dto);
    return this.toResponse(anomaly);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({ summary: 'List anomalies for a user or all users' })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Filter anomalies by user',
  })
  @ApiResponse({
    status: 200,
    description: 'Anomalies listed',
    type: PortfolioAnomaliesListResponseDto,
  })
  async listAnomalies(
    @Query('userId') userId?: string,
  ): Promise<PortfolioAnomaliesListResponseDto> {
    const anomalies = await this.portfolioAnomalyService.getAnomalies(userId);
    return {
      anomalies: anomalies.map((anomaly) => this.toResponse(anomaly)),
      total: anomalies.length,
    };
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.REVIEWER)
  @ApiOperation({ summary: 'Acknowledge or reopen a portfolio anomaly' })
  @ApiResponse({
    status: 200,
    description: 'Anomaly reviewed',
    type: PortfolioAnomalyResponseDto,
  })
  async reviewAnomaly(
    @Param('id') id: string,
    @Body() dto: ReviewPortfolioAnomalyDto,
    @Req() req: RequestWithUser,
  ): Promise<PortfolioAnomalyResponseDto> {
    const anomaly = await this.portfolioAnomalyService.reviewAnomaly(
      id,
      req.user.id,
      dto,
    );
    return this.toResponse(anomaly);
  }

  private toResponse(anomaly: PortfolioAnomaly): PortfolioAnomalyResponseDto {
    return {
      id: anomaly.id,
      userId: anomaly.userId,
      title: anomaly.title,
      description: anomaly.description ?? null,
      anomalyType: anomaly.anomalyType,
      severity: anomaly.severity,
      status: anomaly.status,
      reviewerId: anomaly.reviewerId ?? null,
      reviewerNotes: anomaly.reviewerNotes ?? null,
      reviewedAt: anomaly.reviewedAt ?? null,
      reviewerNotesUpdatedAt: anomaly.reviewerNotesUpdatedAt ?? null,
      createdAt: anomaly.createdAt,
      updatedAt: anomaly.updatedAt,
      version: anomaly.version,
    };
  }
}
