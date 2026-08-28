import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  DeregisterPushTokenDto,
  RegisterPushTokenDto,
} from './dto/push-token.dto';
import { PushTokenService } from './push-token.service';

@ApiTags('notification-devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notification-devices')
export class PushTokenController {
  constructor(private readonly pushTokenService: PushTokenService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register or refresh the current device push token',
  })
  async register(
    @Req() req: { user: { id: string } },
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.pushTokenService.register(req.user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deregister the current device push token' })
  async deregister(
    @Req() req: { user: { id: string } },
    @Body() dto: DeregisterPushTokenDto,
  ): Promise<void> {
    await this.pushTokenService.deregister(req.user.id, dto.deviceId);
  }
}
