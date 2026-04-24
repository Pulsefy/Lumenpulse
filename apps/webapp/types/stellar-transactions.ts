export type TransactionType =
  | "payment"
  | "swap"
  | "trustline"
  | "create_account"
  | "account_merge"
  | "inflation";

export type TransactionStatus = "success" | "pending" | "failed";

export interface StellarTransaction {
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
  description: string;
}

export interface StellarTransactionHistoryResponse {
  transactions: StellarTransaction[];
  total: number;
  nextPage?: string;
}

