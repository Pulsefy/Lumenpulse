"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import StellarBalancesPanel from "@/components/stellar-balances-panel";
import AssetDetail from "@/components/asset-detail";
import WatchlistPanel from "@/components/watchlist-panel";
import { WatchlistProvider } from "@/hooks/use-watchlist";
import { useStellarAccount } from "@/hooks/useStellarAccount";
import { useStellarWallet } from "@/app/providers";
import { getExplorerUrl } from "@/lib/utils";

export default function DashboardPage() {
  const router = useRouter();
  const { publicKey } = useStellarWallet();
  const [selectedAsset, setSelectedAsset] = useState<{
    code: string;
    issuer?: string;
    balance: string;
  } | null>(null);

  const { transactions, isLoading: isLoadingStellar } = useStellarAccount(publicKey);

  return (
    <WatchlistProvider>
      <div className="min-h-screen bg-black text-white p-8">
        {selectedAsset ? (
          <AssetDetail
            code={selectedAsset.code}
            issuer={selectedAsset.issuer}
            balance={selectedAsset.balance}
            onBack={() => setSelectedAsset(null)}
          />
        ) : (
          <>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <button
                onClick={() => router.push("/dashboard/watchlist")}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-lg transition-colors"
              >
                <Star size={16} className="fill-yellow-400" />
                My Watchlist
              </button>
            </div>
            <p className="text-lg mb-4 text-gray-400">Welcome to your personal dashboard.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
              {/* Stellar Panel */}
              <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl">
                <StellarBalancesPanel
                  publicKey={publicKey}
                  onAssetSelect={(asset) => setSelectedAsset(asset)}
                />
              </div>

              {/* Watchlist Panel */}
              <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-white/10 shadow-xl">
                <WatchlistPanel
                  onSelectAsset={(asset) =>
                    setSelectedAsset({
                      code: asset.code,
                      issuer: asset.issuer,
                      balance: "0",
                    })
                  }
                />
              </div>

              {/* Portfolio Overview */}
              <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl">
                <h2 className="text-xl font-semibold mb-4">
                  Portfolio Overview
                </h2>
                <p className="text-gray-400 text-sm">
                  Your portfolio statistics will appear here.
                </p>
                <div className="mt-4 h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full w-[65%]"></div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl col-span-1 md:col-span-2">
                <h2 className="text-xl font-semibold mb-4 font-sans">
                  Recent Transactions
                </h2>
                {!publicKey ? (
                  <p className="text-gray-500 text-sm">Connect your Stellar wallet to view transactions.</p>
                ) : isLoadingStellar ? (
                  <p className="text-gray-500 text-sm animate-pulse">Loading transaction history...</p>
                ) : !transactions || transactions.length === 0 ? (
                  <p className="text-gray-500 text-sm">No transactions found for this account.</p>
                ) : (
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-center border-b border-white/5 pb-2.5 text-sm hover:bg-white/[0.02] p-1.5 rounded-lg transition-colors">
                        <div>
                          <p className="font-semibold text-gray-200 capitalize">
                            {tx.type.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right flex flex-col items-end">
                          {tx.amount && (
                            <p className="font-medium text-gray-200">
                              {parseFloat(tx.amount).toFixed(4)} {tx.asset_code || "XLM"}
                            </p>
                          )}
                          <a
                            href={getExplorerUrl("tx", tx.transaction_hash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline mt-1"
                          >
                            View on Explorer
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl">
                <h2 className="text-xl font-semibold mb-4">Market Insights</h2>
                <p className="text-gray-400 text-sm">Real-time Stellar insights and token trends will appear here.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </WatchlistProvider>
  );
}
