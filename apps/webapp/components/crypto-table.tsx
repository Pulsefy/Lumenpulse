"use client";

import { TrendingUp, TrendingDown, Star, Coins, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";
import { CryptoApiService, transformCryptoData, CryptoMarketResult } from "@/lib/api-services";
import { WatchlistItemType } from "@/lib/watchlist-service";
import { useWatchlist } from "@/hooks/use-watchlist";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";

interface CryptoData {
  id: number;
  name: string;
  symbol: string;
  icon: string;
  price: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volume24h: number;
  marketCap: number;
  sparkline: number[];
}

interface CryptoTableProps {
  formatNumberAction: (num: number) => string;
  showWatchlistToggle?: boolean;
}

export function CryptoTable({ formatNumberAction, showWatchlistToggle = true }: CryptoTableProps) {
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const watchlist = useWatchlist();
  const toggleItem = showWatchlistToggle ? watchlist.toggleItem : async () => ({ added: false });
  const isInWatchlist = showWatchlistToggle ? watchlist.isInWatchlist : () => false;

  // Fetch real crypto data
  useEffect(() => {
    const fetchCryptoData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const result: CryptoMarketResult = await CryptoApiService.getTopCryptocurrencies(20);
        const transformedData = result.data.map(transformCryptoData);
        setCryptoData(transformedData);
        setIsStale(Boolean(result.stale));
        setCachedAt(result.cachedAt ?? null);
        if (result.error && transformedData.length === 0) {
          setError(result.error.message);
        } else if (result.error) {
          setError(result.error.message);
        }
      } catch (err) {
        console.error('Error fetching crypto data:', err);
        if (cryptoData.length === 0) {
          setError(err instanceof Error ? err.message : 'Failed to load cryptocurrency data');
        } else {
          setIsStale(true);
          setError(err instanceof Error ? err.message : 'Showing stale data — refresh failed');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchCryptoData();
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchCryptoData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleFavorite = async (crypto: CryptoData) => {
    const isAdding = !favorites.includes(crypto.id);
    if (!isAdding) {
      setFavorites(favorites.filter((favId) => favId !== crypto.id));
    } else {
      setFavorites([...favorites, crypto.id]);
    }

    // Sync with backend watchlist
    if (showWatchlistToggle) {
      try {
        await toggleItem({
          symbol: crypto.symbol,
          name: crypto.name,
          type: WatchlistItemType.ASSET,
          imageUrl: crypto.icon,
        });
      } catch {
        // Rollback local state
        setFavorites((prev) => 
          isAdding 
            ? prev.filter((id) => id !== crypto.id) 
            : [...prev, crypto.id]
        );
      }
    }
  };

  // Function to render sparkline chart
  const renderSparkline = (data: number[], isPositive: boolean) => {
    const height = 40;
    const width = 120;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    const points = data
      .map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={isPositive ? "#22c55e" : "#ef4444"}
          strokeWidth="1.5"
        />
      </svg>
    );
  };

  const hasData = cryptoData.length > 0;
  const showDegradedBanner = hasData && (isStale || error);

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl p-4 mb-6">
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold font-poppins text-white flex items-center gap-2">
            <span className="w-2 h-6 bg-blue-500 rounded-sm"></span>
            Cryptocurrency Market Cap
          </h2>
          {cachedAt && (
            <span className="text-xs text-gray-500">
              Updated {new Date(cachedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        {showDegradedBanner && (
          <div
            className={
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm ' +
              (isStale
                ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20')
            }
          >
            <AlertTriangle size={14} />
            <span>
              {isStale
                ? 'Showing cached data — live refresh unavailable'
                : error}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <ListSkeleton count={8} rowHeight={72} />
      ) : error && cryptoData.length === 0 ? (
        <ListError
          message={error}
          onRetry={() => window.location.reload()}
        />
      ) : cryptoData.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="No cryptocurrency data"
          description="Unable to load market data. Please try again later."
          action={{
            label: "Reload page",
            onClick: () => window.location.reload(),
          }}
        />
      ) : (
        <div
          className="overflow-x-auto max-h-[600px] overflow-y-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          <table className="w-full">
            <thead className="sticky top-0 bg-black/90 backdrop-blur-md z-10">
              <tr className="border-b border-white/10 text-left">
                <th className="pb-3 pl-2 w-10"></th>
                <th className="pb-3 pl-2 w-10">#</th>
                <th className="pb-3">Coin</th>
                <th className="pb-3 text-right">Price</th>
                <th className="pb-3 text-right">1h</th>
                <th className="pb-3 text-right">24h</th>
                <th className="pb-3 text-right">7d</th>
                <th className="pb-3 text-right">24h Volume</th>
                <th className="pb-3 text-right">Market Cap</th>
                <th className="pb-3 text-right pr-4">Last 7 Days</th>
              </tr>
            </thead>
            <tbody>
              {cryptoData.map((crypto) => (
                <tr
                  key={crypto.id}
                  className="border-b border-white/5 hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-purple-500/20 transition-all duration-200"
                >
                  <td className="py-4 pl-2">
                    <button
                      onClick={() => toggleFavorite(crypto)}
                      className="focus:outline-none transition-colors duration-200"
                    >
                      <Star
                        size={16}
                        className={
                          favorites.includes(crypto.id) || isInWatchlist(crypto.symbol, WatchlistItemType.ASSET)
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-gray-500 group-hover:text-white hover:text-yellow-400 transition-colors duration-200"
                        }
                      />
                    </button>
                  </td>
                  <td className="py-4 pl-2 text-gray-400 group-hover:text-white">
                    {crypto.id}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-2">
                      {crypto.icon ? (
                        <div className="relative w-8 h-8 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-0.5">
                          <Image
                            src={crypto.icon}
                            alt={crypto.name}
                            width={24}
                            height={24}
                            className="rounded-full w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback to symbol if image fails to load
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden w-8 h-8 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center text-xs font-bold">
                            {crypto.symbol.substring(0, 2)}
                          </div>
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center text-xs font-bold">
                          {crypto.symbol.substring(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{crypto.name}</div>
                        <div className="text-xs text-gray-400">
                          {crypto.symbol}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-right font-medium">
                    <span className="font-mono">
                      $
                      {crypto.price.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: crypto.price < 1 ? 6 : 2,
                      })}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <span
                      className={`px-2 py-1 rounded-md ${
                        crypto.change1h >= 0
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {crypto.change1h >= 0 ? "+" : ""}
                      {crypto.change1h.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <span
                      className={`px-2 py-1 rounded-md ${
                        crypto.change24h >= 0
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {crypto.change24h >= 0 ? "+" : ""}
                      {crypto.change24h.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <span
                      className={`px-2 py-1 rounded-md ${
                        crypto.change7d >= 0
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {crypto.change7d >= 0 ? "+" : ""}
                      {crypto.change7d.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-4 text-right font-mono">
                    ${formatNumberAction(crypto.volume24h)}
                  </td>
                  <td className="py-4 text-right font-mono">
                    ${formatNumberAction(crypto.marketCap)}
                  </td>
                  <td className="py-4 text-right pr-4">
                    {renderSparkline(crypto.sparkline, crypto.change7d >= 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
