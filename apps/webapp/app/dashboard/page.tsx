"use client";

import { useState } from "react";
import StellarBalancesPanel from "@/components/stellar-balances-panel";
import StellarTransactionHistoryPanel from "@/components/stellar-transaction-history-panel";
import AssetDetail from "@/components/asset-detail";
import AuthGate from "@/components/auth/AuthGate";
import { useStellarWallet } from "@/app/providers";

export default function DashboardPage() {
  const { publicKey } = useStellarWallet();
  const [selectedAsset, setSelectedAsset] = useState<{
    code: string;
    issuer?: string;
    balance: string;
  } | null>(null);

  return (
    <AuthGate>
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
            <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
            <p className="text-lg mb-4">Welcome to your personal dashboard.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
              <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl">
                <StellarBalancesPanel
                  publicKey={publicKey}
                  onAssetSelect={(asset) => setSelectedAsset(asset)}
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
                <StellarTransactionHistoryPanel publicKey={publicKey} />
              </div>

              <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">Market Insights</h2>
                <p className="text-gray-400">Insights will appear here.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </AuthGate>
  );
}
