import { Controller, Get, Query, UseGuards, Req, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionService } from './transaction.service';
import { UsersService } from '../users/users.service';
import { TransactionHistoryResponseDto } from './dto/transaction.dto';
import {
  PaginationQueryDto,
  createCursorMeta,
  DEFAULT_PAGE_SIZE,
} from '../common/pagination';

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
  @ApiOperation({
    summary: 'Get transaction history for current user',
    description:
      'Returns a cursor-paginated page of transaction history. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
    summary: 'Get transaction history for authenticated user',
    description:
      "Retrieves paginated transaction history for the currently authenticated user's primary Stellar account. " +
      'Results are cached for 60 seconds. Supports pagination via limit and cursor parameters.',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Maximum number of transactions to return per page',
    example: 50,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'cursor',
    description:
      'Pagination cursor from previous response (nextPage field) for fetching subsequent pages',
    example: 'eyJvZmZzZXQiOiA1MCwgImxpbWl0IjogNTB9',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description:
      "Successfully retrieved transaction history for the authenticated user's primary account. " +
      'Use the nextPage cursor to fetch additional pages if available.',
    type: TransactionHistoryResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token is missing or invalid',
  })
  @ApiResponse({
    status: 404,
    description: 'No Stellar accounts found for this user',
  })
  async getTransactionHistory(
    @Req() req: RequestWithUser,
    @Query() query: PaginationQueryDto,
  ): Promise<TransactionHistoryResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const accounts = await this.usersService.getStellarAccounts(req.user.id);
    const typedAccounts = accounts as StellarAccountWithPrimary[];

    const primaryAccount =
      typedAccounts.find((a) => a.isPrimary === true) || typedAccounts[0];

    if (!primaryAccount) {
      return {
        transactions: [],
        total: 0,
        meta: createCursorMeta({ limit }),
      };
    }

    const { transactions, nextPage } =
      await this.transactionService.getTransactionHistory(
        primaryAccount.publicKey,
        limit,
        query.cursor,
      );

    return {
      transactions,
      total: transactions.length,
      nextPage,
      meta: createCursorMeta({ limit, nextCursor: nextPage }),
    };
  }

  @Get('account/:publicKey')
  @ApiOperation({
    summary: 'Get transaction history for a specific public key',
    description:
      'Returns a cursor-paginated page of transaction history for the given account. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns transaction history for the specified account',
    type: TransactionHistoryResponseDto,
    summary: 'Get transaction history for a specific Stellar account',
    description:
      'Retrieves paginated transaction history for any Stellar public key (no authentication required). ' +
      'This endpoint is public and can be used to query transaction history for any account on the Stellar network. ' +
      'Results are cached for 60 seconds.',
  })
  @ApiParam({
    name: 'publicKey',
    description:
      'Stellar public key (account ID) to retrieve transaction history for. Must be a valid 56-character public key starting with "G".',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIREXOWJ2GY2FOLGABIDESX56JP2',
  })
  @ApiQuery({
    name: 'limit',
    description:
      'Maximum number of transactions to return per page (default: 50)',
    example: 50,
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'cursor',
    description:
      'Pagination cursor from previous response for fetching subsequent pages',
    example: 'eyJvZmZzZXQiOiA1MCwgImxpbWl0IjogNTB9',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description:
      'Successfully retrieved transaction history for the specified account. ' +
      'Use the nextPage cursor to fetch additional pages if available.',
    type: TransactionHistoryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid public key format',
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found or has no transactions',
  })
  async getTransactionHistoryForAccount(
    @Param('publicKey') publicKey: string,
    @Query() query: PaginationQueryDto,
  ): Promise<TransactionHistoryResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { transactions, nextPage } =
      await this.transactionService.getTransactionHistory(
        publicKey,
        limit,
        query.cursor,
      );

    return {
      transactions,
      total: transactions.length,
      nextPage,
      meta: createCursorMeta({ limit, nextCursor: nextPage }),
    };
  }
}
