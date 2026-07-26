import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationFanoutService } from './notification-fanout.service';
import {
  FanoutRequestDto,
  FanoutResultDto,
  SuppressionLogResponseDto,
} from './dto/fanout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('notification-fanout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationFanoutController {
  constructor(private readonly fanoutService: NotificationFanoutService) {}

  @Post('fanout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fan out a notification to targeted users',
    description:
      'Creates notifications for all users whose watchlists match the event, ' +
      'filtered by their notification preferences. Suppressed notifications are logged for debugging.',
  })
  @ApiResponse({
    status: 200,
    description: 'Fanout completed successfully',
    type: FanoutResultDto,
  })
  async fanout(@Body() request: FanoutRequestDto): Promise<FanoutResultDto> {
    return this.fanoutService.fanout(request);
  }

  @Get('suppression-logs')
  @ApiOperation({
    summary: 'Get notification suppression logs',
    description:
      'Retrieves suppression logs for debugging and observability. ' +
      'Shows why notifications were not delivered to specific users.',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({
    name: 'eventCategory',
    required: false,
    description: 'Filter by event category',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max results (default 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of suppression logs',
    type: [SuppressionLogResponseDto],
  })
  async getSuppressionLogs(
    @Query('userId') userId?: string,
    @Query('eventCategory') eventCategory?: string,
    @Query('limit') limit?: number,
  ): Promise<SuppressionLogResponseDto[]> {
    return this.fanoutService.getSuppressionLogs(
      userId,
      eventCategory,
      limit ?? 50,
    );
  }
}
