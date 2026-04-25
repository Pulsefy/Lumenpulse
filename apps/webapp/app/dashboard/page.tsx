"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStellarAccount } from "../../hooks/useStellarAccount";
import { Wallet, ArrowUpRight, ArrowDownLeft, Clock, TrendingUp } from "lucide-react";

export default function DashboardPage() {
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const router = useRouter();

  // For demo purposes, we use a default key if none is set
  // In a real app, this would come from the connected wallet (Freighter/Albedo)
  const defaultPublicKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

  useEffect(() => {
    // Check if user is authenticated
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard");
    } else {
      setIsLoadingAuth(false);
      setPublicKey(defaultPublicKey);
    }
  }, [router]);

  const { balances, transactions, isLoading: isLoadingStellar, error } = useStellarAccount(publicKey);

  if (isLoadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#db74cf] to-blue-500 bg-clip-text text-transparent">
            Stellar Dashboard
          </h1>
          <p className="text-gray-400 mt-1">Overview of your Stellar account and assets</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xs">
            <p className="text-gray-500 uppercase font-semibold">Connected Key</p>
            <p className="font-mono text-gray-300">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}` : "Not connected"}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-8">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Portfolio Overview Card */}
        <div className="lg:col-span-2 bg-gray-900/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#db74cf]" />
              Portfolio Assets
            </h2>
            <button className="text-xs text-blue-400 hover:underline">View All Assets</button>
          </div>

          {isLoadingStellar ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-white/5 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {balances.length > 0 ? (
                balances.map((balance, index) => (
                  <div
                    key={index}
                    className="bg-white/5 border border-white/5 hover:border-white/10 transition-all p-4 rounded-xl flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center font-bold text-blue-400">
                        {balance.assetCode ? balance.assetCode[0] : "X"}
                      </div>
                      <div>
                        <p className="font-bold text-lg">{balance.assetCode || "XLM"}</p>
                        <p className="text-xs text-gray-500">
                          {balance.assetType === "native" ? "Native Asset" : "Credit Asset"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-mono font-bold text-white group-hover:text-blue-400 transition-colors">
                        {parseFloat(balance.balance).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-2 py-12 text-center text-gray-500 italic">
                  No assets found for this account.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent Transactions Card */}
        <div className="bg-gray-900/40 backdrop-blur-md border border-white/10 p-6 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-400" />
              Recent Activity
            </h2>
          </div>

          <div className="space-y-4">
            {isLoadingStellar ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 bg-white/5 animate-pulse rounded-xl" />
              ))
            ) : transactions.length > 0 ? (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        tx.type === "payment"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {tx.type === "payment" ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold capitalize">{tx.type.replace("_", " ")}</p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(tx.created_at).toLocaleDateString()} • {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  {tx.amount && (
                    <p className="text-sm font-mono font-bold text-gray-300">
                      {parseFloat(tx.amount).toFixed(2)} {tx.asset_code || "XLM"}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-gray-500 italic text-sm">
                No recent activity found.
              </div>
            )}
          </div>

          <button className="w-full mt-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all">
            View All Transactions
          </button>
        </div>
      </div>
    </div>
  );
}
