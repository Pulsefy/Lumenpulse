export interface StellarContracts {
  lumenToken: string | null;
  crowdfundVault: string | null;
  projectRegistry: string | null;
  contributorRegistry: string | null;
  matchingPool: string | null;
  treasury: string | null;
}

export interface StellarConfig {
  network: 'testnet' | 'mainnet';
  horizonUrl: string;
  sorobanRpcUrl: string | null;
  networkPassphrase: string;
  contracts: StellarContracts;
}
