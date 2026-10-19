import type { Wallet } from '@/contexts/WalletContext';

export const DEFAULT_WALLETS: Wallet[] = [
  {
    id: 'wallet-1',
    label: 'Primary Account',
    address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    chain: 'XLM',
    balance: '1,250.50 XLM',
    balanceUSD: 156.31,
    change24h: '+2.4%',
    changePositive: true,
    assetCount: 3,
  },
  {
    id: 'wallet-2',
    label: 'Savings Vault',
    address: 'GBRPYHIL2C6Q2XQY5W4O6OQK5C6G3XQ2M3NQ5H1R8S9T0U1V2W3X4Y5Z',
    chain: 'USDC',
    balance: '500.00 USDC',
    balanceUSD: 500.0,
    change24h: '+0.1%',
    changePositive: true,
    assetCount: 1,
  },
  {
    id: 'wallet-3',
    label: 'Liquidity Pool',
    address: 'GCDGQPJ6RTYW7W3U4K2O6ZLH5P7K4M3N8V2Q1X9R6S8T3U4V5W6X7Y8Z',
    chain: 'AQUA',
    balance: '15,000.00 AQUA',
    balanceUSD: 75.0,
    change24h: '-0.8%',
    changePositive: false,
    assetCount: 4,
  },
];
