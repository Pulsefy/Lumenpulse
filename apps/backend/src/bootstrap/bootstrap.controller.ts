import {
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BootstrapService } from './bootstrap.service';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, UserRole } from '../auth/decorators/auth.decorators';

@ApiTags('bootstrap')
@Controller('admin')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post('bootstrap')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Bootstrap testnet demo data',
    description:
      'Seeds a comprehensive set of demo data for testnet walkthroughs. ' +
      'Gated to testnet only and requires BOOTSTRAP_DEMO_DATA_ENABLED=true. ' +
      'Resets existing demo data before reseeding, so it is safe to repeat.',
  })
  @ApiResponse({
    status: 201,
    description: 'Demo data bootstrapped successfully',
    type: BootstrapResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — not on testnet or feature disabled',
  })
  async bootstrap(): Promise<BootstrapResponseDto> {
    return this.bootstrapService.bootstrapAll();
  }

  @Post('bootstrap/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reset demo data',
    description:
      'Removes all previously seeded demo data. ' +
      'Only available on testnet with BOOTSTRAP_DEMO_DATA_ENABLED=true.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demo data reset successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — not on testnet or feature disabled',
  })
  async reset(): Promise<{ success: boolean; message: string }> {
    await this.bootstrapService.reset();
    return { success: true, message: 'Demo data reset successfully' };
  }
}
