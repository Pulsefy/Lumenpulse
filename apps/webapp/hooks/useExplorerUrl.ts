"use client";

import { useCallback } from "react";
import { getExplorerUrl } from "@/lib/utils";
import type { ExplorerDestination } from "@/lib/utils";
import { useStellarConfig } from "@/contexts/StellarConfigContext";

/**
 * Returns a URL builder that automatically picks the correct Stellar
 * network from the runtime config, so callers only provide the
 * destination type and id.
 *
 * @example
 * const buildUrl = useExplorerUrl();
 * <a href={buildUrl("contract", vaultContractId)}>View on Explorer</a>
 */
export function useExplorerUrl() {
  const { config } = useStellarConfig();
  const network = (config?.network ?? "testnet") as "testnet" | "mainnet";

  const buildUrl = useCallback(
    (type: ExplorerDestination, id: string): string =>
      getExplorerUrl(type, id, network),
    [network]
  );

  return buildUrl;
}
