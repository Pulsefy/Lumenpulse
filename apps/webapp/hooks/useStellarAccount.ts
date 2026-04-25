import { useState, useEffect } from 'react';
import { StellarApiService } from '../lib/api-services';

export interface StellarBalance {
  assetType: string;
  balance: string;
  assetCode?: string;
  assetIssuer?: string;
}

export interface StellarTransaction {
  id: string;
  type: string;
  amount?: string;
  asset_code?: string;
  from?: string;
  to?: string;
  created_at: string;
  transaction_hash: string;
}

export function useStellarAccount(publicKey: string | null) {
  const [balances, setBalances] = useState<StellarBalance[]>([]);
  const [transactions, setTransactions] = useState<StellarTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [balanceData, txData] = await Promise.all([
          StellarApiService.getAccountBalances(publicKey),
          StellarApiService.getAccountTransactions(publicKey, 5),
        ]);

        setBalances(balanceData.balances || []);
        setTransactions(txData || []);
      } catch (err) {
        console.error('Error fetching Stellar account data:', err);
        setError('Failed to fetch account data. Please ensure the account is active.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [publicKey]);

  return { balances, transactions, isLoading, error };
}
