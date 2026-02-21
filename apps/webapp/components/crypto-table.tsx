"use client";

import { TrendingUp, TrendingDown, Star } from "lucide-react";
import { useState, useEffect } from "react";
import Image from "next/image";
import { CryptoApiService, transformCryptoData } from "@/lib/api-services";

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
}

export function CryptoTable({ formatNumberAction }: CryptoTableProps) {
  const [cryptoData, setCryptoData] = useState<CryptoData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);

  // Fetch real crypto data
  useEffect(() => {
    const fetchCryptoData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const apiData = await CryptoApiService.getTopCryptocurrencies(20);
        const transformedData = apiData.map(transformCryptoData);
        setCryptoData(transformedData);
      } catch (err) {
        console.error('Error fetching crypto data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load cryptocurrency data');
        
        // Fallback to mock data if API fails
        const mockCryptoData = [
          {
            id: 1,
            name: "Bitcoin",
            symbol: "BTC",
            icon: "/crypto-icons/btc.png",
            price: 84127.12,
            change1h: 0.0,
            change24h: 3.8,
            change7d: -2.9,
            volume24h: 29483607871,
            marketCap: 1669278945761,
            sparkline: [65, 59, 80, 81, 56, 55, 40, 60, 70, 45, 50, 55, 70, 75, 65],
          },
          {
            id: 2,
            name: "Ethereum",
            symbol: "ETH",
            icon: "/crypto-icons/eth.png",
            price: 1913.53,
            change1h: -0.3,
            change24h: 2.5,
            change7d: -10.5,
            volume24h: 12779703866,
            marketCap: 230861090232,
            sparkline: [70, 65, 60, 65, 55, 40, 45, 60, 75, 60, 50, 55, 65, 70, 60],
          },
          // Add more mock data as needed...
        ];
        setCryptoData(mockCryptoData);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCryptoData();
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchCryptoData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleFavorite = (id: number) => {
    if (favorites.includes(id)) {
      setFavorites(favorites.filter((favId) => favId !== id));
    } else {
      setFavorites([...favorites, id]);
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

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl p-4 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold font-poppins text-white flex items-center gap-2">
          <span className="w-2 h-6 bg-blue-500 rounded-sm"></span>
          Cryptocurrency Market Cap
          {error && (
            <span className="text-sm text-yellow-400 ml-2 font-normal">
              (Using cached data)
            </span>
          )}
        </h2>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-pulse flex space-x-4">
            <div className="rounded-full bg-white/10 h-12 w-12"></div>
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-white/10 rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </div>
      ) : error && cryptoData.length === 0 ? (
        <div className="text-center text-red-500 py-8">
          {error}
          <button
            className="block mx-auto mt-4 px-4 py-2 bg-primary/20 text-white rounded-lg hover:bg-primary/30 transition-colors"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
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
                      onClick={() => toggleFavorite(crypto.id)}
                      className="focus:outline-none transition-colors duration-200"
                    >
                      <Star
                        size={16}
                        className={
                          favorites.includes(crypto.id)
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

