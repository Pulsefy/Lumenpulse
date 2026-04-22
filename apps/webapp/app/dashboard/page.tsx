"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStellarWallet } from "@/app/providers";
import { StellarApiService, StellarBalance, StellarTransaction, CryptoApiService, CryptoApiData } from "@/lib/api-services";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { publicKey, status, connect } = useStellarWallet();
  const [balances, setBalances] = useState<StellarBalance[]>([]);
  const [transactions, setTransactions] = useState<StellarTransaction[]>([]);
  const [marketData, setMarketData] = useState<CryptoApiData[]>([]);

  useEffect(() => {
    // Check if user is authenticated (you can replace this with your auth logic)
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard");
    } else {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    async function loadDashboardData() {
      if (status === "connected" && publicKey) {
        const accountInfo = await StellarApiService.getAccountInfo(publicKey);
        if (accountInfo) {
          setBalances(accountInfo.balances);
        }
        
        const recentTxs = await StellarApiService.getRecentTransactions(publicKey, 5);
        setTransactions(recentTxs);
      }
      
      try {
        const marketInfo = await CryptoApiService.getTopCryptocurrencies(3);
        setMarketData(marketInfo);
      } catch (err) {
        console.error("Failed to load market data", err);
      }
    }

    if (!isLoading) {
      loadDashboardData();
    }
  }, [status, publicKey, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <p className="text-lg mb-4">Welcome to your personal dashboard!</p>

      {status !== "connected" ? (
        <div className="mt-8 bg-gray-900 border border-gray-800 p-8 rounded-lg text-center">
          <h2 className="text-2xl font-bold mb-4">Wallet Disconnected</h2>
          <p className="text-gray-400 mb-6 max-w-lg mx-auto">Connect your Stellar wallet to view your real-time portfolio, transactions, and account overview.</p>
          <button 
            onClick={connect}
            className="px-6 py-3 bg-gradient-to-r from-[#db74cf] to-blue-500 rounded-lg font-medium text-white hover:opacity-90 transition-opacity"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 shadow-[0_0_15px_rgba(219,116,207,0.1)]">
            <h2 className="text-xl font-semibold mb-4 text-[#db74cf]">Portfolio Overview</h2>
            <div className="space-y-4">
              {balances.length === 0 ? (
                <p className="text-gray-400 text-sm">Account is inactive or has no balances.</p>
              ) : (
                balances.map((b, i) => (
                  <div key={i} className="flex justify-between items-center bg-black/50 p-3 rounded-md border border-white/5">
                    <span className="font-medium text-gray-200">
                      {b.asset_type === 'native' ? 'XLM' : b.asset_code}
                    </span>
                    <span className="font-mono text-white">
                      {parseFloat(b.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
            <h2 className="text-xl font-semibold mb-4 text-blue-400">Recent Transactions</h2>
            <div className="space-y-3">
              {transactions.length === 0 ? (
                <p className="text-gray-400 text-sm">No recent transactions found.</p>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className="text-sm bg-black/50 p-3 rounded-md border border-white/5">
                    <div className="flex justify-between mb-1">
                      <span className="capitalize font-medium text-gray-300">{tx.type.replace('_', ' ')}</span>
                      <span className="text-gray-500 text-xs">{new Date(tx.created_at).toLocaleDateString()}</span>
                    </div>
                    {(tx.amount || tx.starting_balance) && (
                      <div className="text-white font-mono mt-1">
                        {tx.amount || tx.starting_balance} {tx.asset_code || 'XLM'}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
            <h2 className="text-xl font-semibold mb-4 text-white">Market Insights</h2>
            <div className="space-y-3">
              {marketData.length === 0 ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-14 bg-black/50 rounded-md border border-white/5"></div>
                  ))}
                </div>
              ) : (
                marketData.map((coin) => (
                  <div key={coin.id} className="flex items-center justify-between bg-black/50 p-3 rounded-md border border-white/5">
                    <div className="flex items-center gap-3">
                      <img src={coin.image} alt={coin.name} className="w-6 h-6 rounded-full" />
                      <span className="font-medium text-gray-200">{coin.symbol.toUpperCase()}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-mono">${coin.current_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                      <div className={`text-xs ${coin.price_change_percentage_24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {coin.price_change_percentage_24h > 0 ? '+' : ''}{coin.price_change_percentage_24h.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
