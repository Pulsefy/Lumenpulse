import { ApiProperty } from '@nestjs/swagger';

export enum TransactionType {
  PAYMENT = 'payment',
  SWAP = 'swap',
  TRUSTLINE = 'trustline',
  CREATE_ACCOUNT = 'create_account',
  ACCOUNT_MERGE = 'account_merge',
  INFLATION = 'inflation',
}

export enum TransactionStatus {
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
}

export class TransactionDto {
  @ApiProperty({
    description: 'Unique transaction identifier',
    example: 'tx-123456789',
  })
  id: string;

  @ApiProperty({
    enum: TransactionType,
    description: 'Type of transaction on the Stellar network',
    example: TransactionType.PAYMENT,
  })
  type: TransactionType;

  @ApiProperty({
    description: 'Transaction amount (in stroops or smallest unit)',
    example: '1000000',
  })
  amount: string;

  @ApiProperty({
    description: 'Asset code (e.g., USD, EUR, native XLM)',
    example: 'USD',
  })
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer account (null for native XLM)',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIreojrwj2GY2FOLGABIDES4PJ4Q',
    nullable: true,
  })
  assetIssuer: string | null;

  @ApiProperty({
    description: 'Source account (sender) public key',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIREGOWJ2GY2FOLGABIDES4PJ4Q',
  })
  from: string;

  @ApiProperty({
    description: 'Destination account (recipient) public key',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIREXOWJ2GY2FOLGABIDESX56JP2',
  })
  to: string;

  @ApiProperty({
    description: 'Transaction timestamp in ISO 8601 format',
    example: '2024-03-15T10:30:00Z',
  })
  date: string;

  @ApiProperty({
    enum: TransactionStatus,
    description: 'Current status of the transaction',
    example: TransactionStatus.SUCCESS,
  })
  status: TransactionStatus;

  @ApiProperty({
    description: 'Stellar transaction hash',
    example: 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc890',
  })
  transactionHash: string;

  @ApiProperty({
    description: 'Optional transaction memo',
    example: 'Payment for Q1 contribution',
    required: false,
    nullable: true,
  })
  memo?: string;

  @ApiProperty({
    description: 'Transaction fee in stroops',
    example: '100',
    required: false,
    nullable: true,
  })
  fee?: string;

  @ApiProperty({
    description: 'Human-readable description of the transaction',
    example: 'Payment received from funding round',
  })
  description: string;
}

export class TransactionHistoryResponseDto {
  @ApiProperty({
    type: [TransactionDto],
    description: 'Array of transactions for the specified account or user',
  })
  transactions: TransactionDto[];

  @ApiProperty({
    description: 'Total number of transactions matching the query',
    example: 42,
  })
  total: number;

  @ApiProperty({
    description:
      'Cursor for pagination - use as query parameter for next page (if available)',
    example: 'eyJvZmZzZXQiOiA1MCwgImxpbWl0IjogNTB9',
    required: false,
    nullable: true,
  })
  nextPage?: string;
}
