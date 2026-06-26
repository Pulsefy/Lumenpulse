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

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  from: string;
  to: string;
  date: string;
  status: TransactionStatus;
  transactionHash: string;
  memo?: string;
  fee?: string;
}

export interface TransactionHistoryResponse {
  transactions: Transaction[];
  total: number;
  nextPage?: string;
}
