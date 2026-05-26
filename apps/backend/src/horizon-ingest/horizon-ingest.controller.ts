import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { HorizonIngestService } from './horizon-ingest.service';
import { OperationQueryDto } from './dto/operation-query.dto';

@ApiTags('Horizon Ingest')
@Controller('horizon-ingest')
export class HorizonIngestController {
  constructor(private readonly ingestService: HorizonIngestService) {}

  @Get('operations/:accountId')
  @ApiOperation({
    summary: 'Get account operations',
    description:
      'Retrieve ingested Horizon operations for a specific account with pagination and filtering.',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Stellar account public key',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @ApiResponse({
    status: 200,
    description: 'Operations retrieved successfully',
  })
  async getOperations(
    @Param('accountId') accountId: string,
    @Query() query: OperationQueryDto,
  ) {
    return this.ingestService.getOperations(accountId, query);
  }

  @Get('checkpoint/:accountId')
  @ApiOperation({
    summary: 'Get ingestion checkpoint',
    description:
      'Retrieve the current checkpoint (last ingested cursor) for an account.',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Stellar account public key',
  })
  @ApiResponse({
    status: 200,
    description: 'Checkpoint retrieved successfully',
  })
  async getCheckpoint(@Param('accountId') accountId: string) {
    const checkpoint = await this.ingestService.getCheckpoint(accountId);
    return checkpoint ?? { accountId, cursor: null, message: 'No checkpoint found' };
  }

  @Post('backfill/:accountId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger backfill',
    description:
      'Manually trigger a full backfill for an account, starting from the beginning.',
  })
  @ApiParam({
    name: 'accountId',
    description: 'Stellar account public key',
  })
  @ApiResponse({
    status: 202,
    description: 'Backfill job enqueued successfully',
  })
  async triggerBackfill(@Param('accountId') accountId: string) {
    return this.ingestService.triggerBackfill(accountId);
  }
}
