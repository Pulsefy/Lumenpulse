import { Controller, Get, Query, UseGuards, Req, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionService } from './transaction.service';
import { UsersService } from '../users/users.service';
import { TransactionHistoryResponseDto } from './dto/transaction.dto';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
  };
}

interface StellarAccountWithPrimary {
  id: string;
  publicKey: string;
  label?: string;
  isPrimary?: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('transactions')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly usersService: UsersService,
  ) {}

  @Get('history')
  @ApiOperation({ summary: 'Get transaction history for current user' })
  @ApiResponse({
    status: 200,
    description: 'Returns transaction history',
    type: TransactionHistoryResponseDto,
  })
  async getTransactionHistory(
    @Req() req: RequestWithUser,
    @Query() query: TransactionHistoryQueryDto,
  ): Promise<TransactionHistoryResponseDto> {
    const accounts = await this.usersService.getStellarAccounts(req.user.id);
    const typedAccounts = accounts as StellarAccountWithPrimary[];

    const primaryAccount =
      typedAccounts.find((a) => a.isPrimary === true) || typedAccounts[0];

    if (!primaryAccount) {
      return {
        transactions: [],
        total: 0,
      };
    }

    const { transactions, nextCursor, limit, sortOrder } =
      await this.transactionService.getTransactionHistory(
        primaryAccount.publicKey,
        query,
      );

    return {
      items: transactions,
      total: transactions.length,
      nextCursor,
      limit,
      sortOrder,
    };
  }

  @Get('account/:publicKey')
  @ApiOperation({
    summary: 'Get transaction history for a specific public key',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns transaction history for the specified account',
  })
  async getTransactionHistoryForAccount(
    @Param('publicKey') publicKey: string,
    @Query() query: TransactionHistoryQueryDto,
  ) {
    return this.transactionService.getTransactionHistory(publicKey, query);
  }
}
