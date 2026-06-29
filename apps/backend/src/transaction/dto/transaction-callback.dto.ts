import { IsString, IsUrl, IsNotEmpty } from 'class-validator';

export class RegisterTransactionCallbackDto {
  @IsString()
  @IsNotEmpty()
  transactionHash: string;

  @IsUrl()
  @IsNotEmpty()
  callbackUrl: string;
}

export class TransactionStatusUpdateDto {
  transactionHash: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  timestamp: string;
  error?: string;
}
