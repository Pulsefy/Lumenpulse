import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ContributorRegistryService } from './contributor-registry.service';
import { RegisterContributorDto } from './dto/contributor-registry.dto';

@ApiTags('contributor-registry')
@Controller('contributor-registry')
export class ContributorRegistryController {
  constructor(private readonly svc: ContributorRegistryService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a contributor on-chain (testnet, server-signed)' })
  @ApiResponse({ status: 200, schema: { properties: { txHash: { type: 'string' }, status: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Bad request or simulation failure' })
  register(@Body() dto: RegisterContributorDto) {
    return this.svc.register(dto.address, dto.githubHandle);
  }

  @Get('address/:address')
  @ApiOperation({ summary: 'Look up contributor by Stellar wallet address' })
  @ApiParam({ name: 'address', description: "Contributor's G-address" })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  getByAddress(@Param('address') address: string) {
    return this.svc.getByAddress(address);
  }

  @Get('github/:handle')
  @ApiOperation({ summary: 'Look up contributor by GitHub handle' })
  @ApiParam({ name: 'handle', description: 'GitHub username' })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  getByGithub(@Param('handle') handle: string) {
    return this.svc.getByGithub(handle);
  }

  @Get('reputation/:address')
  @ApiOperation({ summary: 'Read reputation score for a contributor (cached 60 s)' })
  @ApiParam({ name: 'address', description: "Contributor's G-address" })
  getReputation(@Param('address') address: string) {
    return this.svc.getReputation(address);
  }
}
