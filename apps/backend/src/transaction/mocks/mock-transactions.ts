import {
  TransactionDto,
  TransactionType,
  TransactionStatus,
} from '../dto/transaction.dto';

export const mockTransactions: TransactionDto[] = [
  {
    id: '1',
    type: TransactionType.PAYMENT,
    amount: '250.50',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
    memo: 'Payment for services',
    fee: '100',
    description: 'Sent 250.50 XLM to GABC...7890',
  },
  {
    id: '2',
    type: TransactionType.PAYMENT,
    amount: '1000.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GXYZ9876543210FEDCBA9876543210FEDCBA9876543210',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890b2c3',
    memo: 'Received from exchange',
    fee: '100',
    description: 'Received 1000.00 XLM from GXYZ...7890',
  },
  {
    id: '3',
    type: TransactionType.SWAP,
    amount: '500.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890c3d4',
    memo: 'Swapped XLM for USDC',
    fee: '150',
    description: 'Swapped 500.00 XLM for USDC',
  },
  {
    id: '4',
    type: TransactionType.TRUSTLINE,
    amount: '0',
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'd4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890d4e5',
    memo: 'Added USDC trustline',
    fee: '100',
    description: 'Added trustline for USDC',
  },
  {
    id: '5',
    type: TransactionType.PAYMENT,
    amount: '75.25',
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    from: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890e5f6',
    memo: 'USDC payment received',
    fee: '100',
    description: 'Received 75.25 USDC from GABC...7890',
  },
  {
    id: '6',
    type: TransactionType.CREATE_ACCOUNT,
    amount: '2.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GNEWACCOUNT1234567890NEWACCOUNT1234567890',
    date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: 'f67890a1b2c3d4e5f67890a1b2c3d4e5f67890f678',
    memo: 'Created new account for friend',
    fee: '100',
    description: 'Created account GNEW...7890 with 2.00 XLM',
  },
  {
    id: '7',
    type: TransactionType.PAYMENT,
    amount: '1500.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GEXCHANGE1234567890EXCHANGE1234567890',
    date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago
    status: TransactionStatus.FAILED,
    transactionHash: '07890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c',
    memo: 'Failed withdrawal attempt',
    fee: '100',
    description: 'Sent 1500.00 XLM to GEXC...7890',
  },
  {
    id: '8',
    type: TransactionType.ACCOUNT_MERGE,
    amount: '0',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GOLDACCOUNT1234567890OLDACCOUNT1234567890',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), // 25 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: '1890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3',
    memo: 'Merged old account',
    fee: '100',
    description: 'Merged account into GD7K...FDC',
  },
  {
    id: '9',
    type: TransactionType.SWAP,
    amount: '1000.00',
    assetCode: 'XLM',
    assetIssuer: null,
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: '290a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d',
    memo: 'Swapped XLM for BTC',
    fee: '150',
    description: 'Swapped 1000.00 XLM for BTC',
  },
  {
    id: '10',
    type: TransactionType.TRUSTLINE,
    amount: '0',
    assetCode: 'BTC',
    assetIssuer: 'GBTC1234567890BTC1234567890BTC1234567890',
    from: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    to: 'GD7KJ723DHD6OJXDOIXYT3DVWK4DGLAY7T37V7CP6PFN5BHY4VQL5FDC',
    date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
    status: TransactionStatus.SUCCESS,
    transactionHash: '3a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e',
    memo: 'Added BTC trustline',
    fee: '100',
    description: 'Added trustline for BTC',
  },
];

export const getMockTransactions = (
  limit: number = 50,
  cursor?: string,
): { transactions: TransactionDto[]; nextPage?: string } => {
  let transactions = [...mockTransactions];

  // Sort by date descending (newest first)
  transactions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // Handle cursor (offset)
  if (cursor) {
    const cursorIndex = transactions.findIndex((t) => t.id === cursor);
    if (cursorIndex !== -1) {
      transactions = transactions.slice(cursorIndex + 1);
    }
  }

  // Apply limit
  const hasMore = transactions.length > limit;
  const limitedTransactions = transactions.slice(0, limit);
  const nextPage = hasMore
    ? limitedTransactions[limitedTransactions.length - 1]?.id
    : undefined;

  return {
    transactions: limitedTransactions,
    nextPage,
  };
};
