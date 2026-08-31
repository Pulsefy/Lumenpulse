import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PriceAlertRuleService } from './price-alert-rule.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePriceAlertRuleDto } from './dto/create-price-alert-rule.dto';
import { UpdatePriceAlertRuleDto } from './dto/update-price-alert-rule.dto';
import { PriceAlertRule } from './entities/price-alert-rule.entity';

@ApiTags('price-alerts')
@ApiBearerAuth('JWT-auth')
@Controller('price-alerts')
@UseGuards(JwtAuthGuard)
export class PriceAlertRuleController {
  constructor(private readonly ruleService: PriceAlertRuleService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all price alert rules',
    description: 'Returns all price alert rules for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of price alert rules',
    type: [PriceAlertRule],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Request() req: any): Promise<PriceAlertRule[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.ruleService.findAllForUser(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a price alert rule by ID',
    description:
      'Returns a single price alert rule owned by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Price alert rule',
    type: PriceAlertRule,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async findOne(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<PriceAlertRule> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.ruleService.findOneForUser(userId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a price alert rule',
    description: 'Create a new price alert rule for the authenticated user',
  })
  @ApiResponse({
    status: 201,
    description: 'Price alert rule created',
    type: PriceAlertRule,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Request() req: any,
    @Body() dto: CreatePriceAlertRuleDto,
  ): Promise<PriceAlertRule> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.ruleService.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a price alert rule',
    description: 'Update an existing price alert rule',
  })
  @ApiResponse({
    status: 200,
    description: 'Price alert rule updated',
    type: PriceAlertRule,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePriceAlertRuleDto,
  ): Promise<PriceAlertRule> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.ruleService.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a price alert rule',
    description: 'Remove a price alert rule',
  })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async remove(@Request() req: any, @Param('id') id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.ruleService.remove(userId, id);
  }
}
