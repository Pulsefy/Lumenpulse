import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TransactionStatusService } from './transaction-status.service';
import { RegisterTransactionCallbackDto } from './dto/transaction-callback.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Transaction Status')
@Controller('transactions/status')
export class TransactionStatusController {
  constructor(private readonly statusService: TransactionStatusService) {}

  @Post('callback')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Register a callback URL for transaction status updates',
  })
  @ApiResponse({ status: 202, description: 'Callback registered successfully' })
  async registerCallback(@Body() dto: RegisterTransactionCallbackDto) {
    await this.statusService.registerCallback(dto);
    return { message: 'Callback registered successfully' };
  }
}
