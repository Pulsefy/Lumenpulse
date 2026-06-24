import { LinkedStellarAccount } from './api';

export const resolveActiveAccount = (
  accounts: LinkedStellarAccount[],
  preferredPublicKey: string | null,
): LinkedStellarAccount | null => {
  if (accounts.length === 0) {
    return null;
  }

  if (preferredPublicKey) {
    const matched = accounts.find((account) => account.publicKey === preferredPublicKey);
    if (matched) {
      return matched;
    }
  }

  const primary = accounts.find((account) => account.isPrimary);
  return primary ?? accounts[0];
};
