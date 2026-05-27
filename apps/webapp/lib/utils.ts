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
const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer";

export function getExplorerUrl(
  type: "tx" | "account",
  id: string,
  network: "testnet" | "mainnet" = "testnet"
): string {
  const net = network === "mainnet" ? "public" : "testnet";
  return `${STELLAR_EXPERT_BASE}/${net}/${type}/${id}`;
}
