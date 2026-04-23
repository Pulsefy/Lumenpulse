import { apiClient } from './api-client';
import { Transaction, TransactionHistoryResponse } from '../lib/types/transaction';

export const transactionApi = {
  getHistory: async (limit?: number, cursor?: string): Promise<TransactionHistoryResponse> => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (cursor) params.append('cursor', cursor);
    
    const url = `/transactions/history${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await apiClient.get<TransactionHistoryResponse>(url);
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error?.message || 'Failed to fetch transaction history');
  },

  getForAccount: async (publicKey: string, limit?: number, cursor?: string): Promise<TransactionHistoryResponse> => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (cursor) params.append('cursor', cursor);
    
    const url = `/transactions/account/${publicKey}${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await apiClient.get<TransactionHistoryResponse>(url);
    if (response.success && response.data) {
      return response.data;
    }
    throw new Error(response.error?.message || 'Failed to fetch account transactions');
  },
};