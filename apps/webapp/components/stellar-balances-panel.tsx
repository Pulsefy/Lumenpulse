"use client";

import { useStellarAccount, StellarBalance } from "@/hooks/useStellarAccount";

export interface Asset {
  code: string;
  issuer?: string;
  balance: string;
}

export default function StellarBalancesPanel({
  publicKey,
  onAssetSelect,
}: {
  publicKey: string | null;
  onAssetSelect?: (asset: Asset) => void;
}) {
  const { balances, isLoading, error } = useStellarAccount(publicKey);

  // No wallet state
  if (!publicKey) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>
        <p className="text-gray-400">No wallet connected</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>
        <div className="text-gray-400 animate-pulse">Loading balances...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  const sortedBalances = [...balances].sort((a: StellarBalance, b: StellarBalance) => {
    if (a.assetType === "native") return -1;
    if (b.assetType === "native") return 1;
    return 0;
  });

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>

      {sortedBalances.length === 0 ? (
        <p className="text-gray-400">No assets found</p>
      ) : (
        <div className="space-y-2">
          {sortedBalances.map((b, i) => (
            <div
              key={i}
              onClick={() =>
                onAssetSelect?.({
                  code: b.assetType === "native" ? "XLM" : b.assetCode || "",
                  issuer: b.assetIssuer,
                  balance: b.balance,
                })
              }
              className="flex justify-between items-center border-b border-gray-700 pb-2 hover:bg-white/5 p-2 rounded-lg cursor-pointer transition-colors"
            >
              <span className="font-mono text-sm">
                {b.assetType === "native"
                  ? "XLM"
                  : `${b.assetCode}:${b.assetIssuer?.slice(0, 6)}...`}
              </span>

              <span className="font-medium">
                {parseFloat(b.balance).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 7,
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
