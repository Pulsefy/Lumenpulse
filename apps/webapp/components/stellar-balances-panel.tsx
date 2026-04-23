"use client";

import { useEffect, useState } from "react";

type Balance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

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
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!publicKey) return;

    async function fetchBalances() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/stellar/accounts/${publicKey}/balances`,
        );

        if (!res.ok) {
          throw new Error("Failed to fetch balances");
        }

        const data = await res.json();

        const sorted = (data?.balances || []).sort((a: Balance, b: Balance) => {
          if (a.asset_type === "native") return -1;
          if (b.asset_type === "native") return 1;
          return 0;
        });

        setBalances(sorted);
      } catch (err) {
        console.error(err);
        setError("Unable to load balances");
      } finally {
        setLoading(false);
      }
    }

    fetchBalances();
  }, [publicKey]);

  // No wallet state
  if (!publicKey) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>
        <p className="text-gray-400">No wallet connected</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-gray-400">Loading balances...</div>;
  }

  if (error) {
    return <div className="text-red-400 text-sm">{error}</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Stellar Balances</h2>

      {balances.length === 0 ? (
        <p className="text-gray-400">No assets found</p>
      ) : (
        <div className="space-y-2">
          {balances.map((b, i) => (
            <div
              key={i}
              onClick={() =>
                onAssetSelect?.({
                  code: b.asset_type === "native" ? "XLM" : b.asset_code || "",
                  issuer: b.asset_issuer,
                  balance: b.balance,
                })
              }
              className="flex justify-between items-center border-b border-gray-700 pb-2 hover:bg-white/5 p-2 rounded-lg cursor-pointer transition-colors"
            >
              <span>
                {b.asset_type === "native"
                  ? "XLM"
                  : `${b.asset_code}:${b.asset_issuer?.slice(0, 6)}...`}
              </span>

              <span className="font-medium">
                {parseFloat(b.balance).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
