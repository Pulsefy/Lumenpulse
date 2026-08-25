import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format large numbers
export const formatNumber = (num: number) => {
  if (num >= 1000000000000) {
    return `$${(num / 1000000000000).toFixed(2)}T`;
  } else if (num >= 1000000000) {
    return `$${(num / 1000000000).toFixed(2)}B`;
  } else if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(2)}M`;
  } else {
    return `$${num.toFixed(2)}`;
  }
};

// Stellar explorer URL helpers
// Override via NEXT_PUBLIC_STELLAR_EXPLORER_URL to switch explorer (e.g. stellar.expert, steexp.com).
// Must be the base path before the /{network}/{type}/{id} segments.
const STELLAR_EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ?? "https://stellar.expert/explorer";

/** Destination types supported by the Stellar explorer. */
export type ExplorerDestination = "tx" | "account" | "contract";

/** Build a Stellar explorer URL for transactions, accounts, or Soroban contracts. */
export function getExplorerUrl(
  type: ExplorerDestination,
  id: string,
  network: "testnet" | "mainnet" = "testnet"
): string {
  const net = network === "mainnet" ? "public" : "testnet";
  return `${STELLAR_EXPLORER_BASE}/${net}/${type}/${id}`;
}
