import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SignalsService } from './signals.service';
import { UserSignalsResponseDto } from './dto/signals.dto';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
  };
}

@ApiTags('signals')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get('latest')
  @ApiOperation({
    summary: 'Get the latest risk and activity signals for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Latest deterministic signal summary for the current user',
    type: UserSignalsResponseDto,
  })
  async getLatestSignals(
    @Req() req: RequestWithUser,
  ): Promise<UserSignalsResponseDto> {
    return this.signalsService.getLatestSignals(req.user.id);
  }
}
