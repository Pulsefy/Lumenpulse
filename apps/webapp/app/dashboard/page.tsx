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

              {/* Recent Stellar Operations */}
              <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-xl border border-white/10 shadow-2xl col-span-1 md:col-span-2 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none transition-all group-hover:bg-blue-500/10"></div>
                <div className="flex justify-between items-center mb-5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></div>
                    <h2 className="text-xl font-bold tracking-tight text-white font-sans">
                      Recent Stellar Operations
                    </h2>
                  </div>
                  <span className="text-xs text-gray-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                    Live Horizon feed
                  </span>
                </div>
                {!publicKey ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm font-medium">Connect your Stellar wallet to view recent account activity.</p>
                  </div>
                ) : isLoadingStellar ? (
                  <div className="space-y-3 py-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between items-center border-b border-white/5 pb-3 animate-pulse">
                        <div className="space-y-2">
                          <div className="h-4 w-32 bg-white/10 rounded"></div>
                          <div className="h-3 w-24 bg-white/5 rounded"></div>
                        </div>
                        <div className="h-6 w-16 bg-white/10 rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : !transactions || transactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
                      <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-gray-500 text-sm">No recent activities found for this account.</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
                    {transactions.map((tx: any) => {
                      let title = "Stellar Operation";
                      let desc = `Operation ID: ${tx.id.substring(0, 8)}...`;
                      let colorStyle = "text-gray-400 bg-gray-500/10 border-gray-500/20";
                      let iconSvg = (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      );
                      
                      const isOutgoing = tx.from === publicKey || tx.source_account === publicKey;
                      const isIncoming = tx.to === publicKey || tx.account === publicKey;

                      if (tx.type === "payment") {
                        if (isOutgoing) {
                          title = "Payment Sent";
                          desc = `To ${tx.to ? `${tx.to.substring(0, 6)}...${tx.to.substring(50)}` : "unknown"}`;
                          colorStyle = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                          iconSvg = (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          );
                        } else {
                          title = "Payment Received";
                          desc = `From ${tx.from ? `${tx.from.substring(0, 6)}...${tx.from.substring(50)}` : "unknown"}`;
                          colorStyle = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                          iconSvg = (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7-7v18" />
                            </svg>
                          );
                        }
                      } else if (tx.type === "create_account") {
                        if (isIncoming) {
                          title = "Account Funded";
                          desc = `Funded with ${tx.starting_balance || "0"} XLM`;
                          colorStyle = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                        } else {
                          title = "Account Created";
                          desc = `Created account ${tx.account ? `${tx.account.substring(0, 6)}...` : ""}`;
                          colorStyle = "text-blue-400 bg-blue-500/10 border-blue-500/20";
                        }
                        iconSvg = (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                          </svg>
                        );
                      } else if (tx.type === "change_trust") {
                        title = "Trustline Updated";
                        desc = `Asset: ${tx.asset_code || "Unknown"} | Limit: ${tx.limit ? parseFloat(tx.limit).toFixed(0) : "0"}`;
                        colorStyle = "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
                        iconSvg = (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        );
                      } else if (tx.type === "set_options") {
                        title = "Settings Modified";
                        desc = "Account options / thresholds updated";
                        colorStyle = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                        iconSvg = (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        );
                      }

                      return (
                        <div key={tx.id} className="flex justify-between items-center border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] p-3 rounded-lg transition-all duration-200">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${colorStyle}`}>
                              {iconSvg}
                            </div>
                            <div>
                              <p className="font-semibold text-white tracking-wide">
                                {title}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {desc}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            {tx.amount && (
                              <p className="font-semibold text-gray-200">
                                {parseFloat(tx.amount).toFixed(4)} {tx.asset_code || "XLM"}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-gray-500">
                                {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <a
                                href={getExplorerUrl("tx", tx.transaction_hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium hover:underline flex items-center gap-0.5"
                              >
                                Detail
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
