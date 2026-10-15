import { IsString, IsUrl, IsNotEmpty, IsOptional } from 'class-validator';

export class RegisterTransactionCallbackDto {
  @IsString()
  @IsNotEmpty()
  transactionHash: string;

  @IsUrl()
  @IsNotEmpty()
  callbackUrl: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secretId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  previousSecretId?: string;
}

export class TransactionStatusUpdateDto {
  transactionHash: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  timestamp: string;
  error?: string;
}
