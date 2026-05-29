import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { MatchingPoolService } from './matching-pool.service';
import { CreateRoundDto } from './dto/create-round.dto';
import { ApproveProjectDto } from './dto/approve-project.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';

@ApiTags('Matching Pool Admin')
@ApiSecurity('basic')
@UseGuards(AdminAuthGuard)
@Controller('matching-pool/admin')
export class MatchingPoolController {
  constructor(private readonly matchingPoolService: MatchingPoolService) {}

  @Post('rounds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new matching pool round',
    description: 'Creates a new matching round in the smart contract on-chain.',
  })
  @ApiResponse({
    status: 201,
    description: 'Round created successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input parameters or on-chain error.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access (invalid credentials).',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden (admin role required).',
  })
  async createRound(@Body() createRoundDto: CreateRoundDto) {
    return this.matchingPoolService.createRound(createRoundDto);
  }

  @Post('rounds/:roundId/approve-project')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a project for matching round eligibility',
    description:
      'Flags a project identifier as eligible for QF matching in the given round.',
  })
  @ApiParam({ name: 'roundId', description: 'Numeric matching round ID' })
  @ApiResponse({
    status: 200,
    description: 'Project approved successfully.',
  })
  @ApiResponse({ status: 404, description: 'Round not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async approveProject(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Body() approveProjectDto: ApproveProjectDto,
  ) {
    return this.matchingPoolService.approveProject(
      roundId,
      approveProjectDto.projectId,
    );
  }

  @Post('rounds/:roundId/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finalize a matching round',
    description:
      'Finalizes the round in the smart contract, preventing further contributions.',
  })
  @ApiParam({ name: 'roundId', description: 'Numeric matching round ID' })
  @ApiResponse({
    status: 200,
    description: 'Round finalized successfully.',
  })
  @ApiResponse({ status: 404, description: 'Round not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async finalizeRound(@Param('roundId', ParseIntPipe) roundId: number) {
    return this.matchingPoolService.finalizeRound(roundId);
  }

  @Get('rounds/:roundId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get details of a matching round',
    description: 'Retrieves current on-chain or mock status for a round.',
  })
  @ApiParam({ name: 'roundId', description: 'Numeric matching round ID' })
  @ApiResponse({
    status: 200,
    description: 'Round details retrieved successfully.',
  })
  @ApiResponse({ status: 404, description: 'Round not found.' })
  async getRound(@Param('roundId', ParseIntPipe) roundId: number) {
    return this.matchingPoolService.getRound(roundId);
  }

  @Get('rounds')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all matching rounds',
    description: 'Lists all registered matching rounds.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of rounds retrieved successfully.',
  })
  async listRounds() {
    return this.matchingPoolService.listRounds();
  }
}
