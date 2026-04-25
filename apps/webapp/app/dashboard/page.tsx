"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import StellarBalancesPanel from "@/components/stellar-balances-panel";
import AssetDetail from "@/components/asset-detail";
import WatchlistPanel from "@/components/watchlist-panel";
import { WatchlistProvider } from "@/hooks/use-watchlist";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<{
    code: string;
    issuer?: string;
    balance: string;
  } | null>(null);

  // For demo purposes, we use a default key if none is set
  // In a real app, this would come from the connected wallet (Freighter/Albedo)
  const defaultPublicKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  useEffect(() => {
    // TODO: replace this with real user wallet later
    // For now, we simulate "no wallet connected"
    // In a real app, we would fetch the public key from the session/profile
    setPublicKey(null);

    setIsLoading(false);
  }, []);

  const { balances, transactions, isLoading: isLoadingStellar, error } = useStellarAccount(publicKey);

  if (isLoadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

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
          <p className="text-lg mb-4">Welcome to your personal dashboard.</p>

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

              <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">
                  Portfolio Overview
                </h2>
                <p className="text-gray-400">
                  Your portfolio statistics will appear here.
                </p>
                <div className="mt-4 h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full w-[65%]"></div>
                </div>
              </div>

              <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">
                  Recent Transactions
                </h2>
                <p className="text-gray-400">
                  Your transactions will appear here.
                </p>
              </div>

            <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
              <h2 className="text-xl font-semibold mb-4">Market Insights</h2>
              <p className="text-gray-400">Insights will appear here.</p>
            </div>
          </div>
        </>
      )}
    </div>
    </WatchlistProvider>
  );
}
