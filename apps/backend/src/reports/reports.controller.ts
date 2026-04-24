import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // assuming auth guard exists
import { RolesGuard } from '../auth/roles.guard'; // assuming roles guard
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  async createReport(@Body() dto: CreateReportDto, @Request() req) {
    const reporterId = req.user.id;
    return this.reportsService.createReport(
      reporterId,
      dto.contentType,
      dto.contentId,
      dto.reason,
      dto.description,
    );
  }

  @Get('pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN) // assuming admin role
  async getPendingReports() {
    return this.reportsService.getPendingReports();
  }

  @Put(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateReportStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportStatusDto,
    @Request() req,
  ) {
    const reviewedBy = req.user.id;
    return this.reportsService.updateReportStatus(
      id,
      dto.status,
      reviewedBy,
      dto.reviewNotes,
    );
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getReport(@Param('id', ParseIntPipe) id: number) {
    return this.reportsService.getReportById(id);
  }
}