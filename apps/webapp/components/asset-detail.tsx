"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  ArrowLeft,
  Wallet,
  Globe,
  MessageSquare,
} from "lucide-react";
import { CryptoApiService, transformCryptoData } from "@/lib/api-services";
import { Asset } from "./stellar-balances-panel";

interface Transaction {
  id: string;
  type: string;
  amount: string;
  asset: string;
  date: string;
  status: string;
}

interface AssetDetailProps extends Asset {
  onBack: () => void;
}

export default function AssetDetail({
  code,
  issuer,
  balance,
  onBack,
}: AssetDetailProps) {
  const [loading, setLoading] = useState(true);
  const [priceData, setPriceData] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sentiment, setSentiment] = useState({ score: 0.75, label: "Bullish" });

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch price data if available (mapping XLM or other codes)
        const apiData = await CryptoApiService.getTopCryptocurrencies(50);
        const transformed = apiData.map(transformCryptoData);
        const matched = transformed.find(
          (c) => c.symbol.toLowerCase() === code.toLowerCase(),
        );

        if (matched) {
          setPriceData(matched);
        } else {
          // Mock price for custom assets
          setPriceData({
            price: 1.25,
            change24h: 3.5,
            sparkline: [
              40, 45, 42, 48, 50, 47, 52, 55, 53, 58, 60, 57, 62, 65, 63,
            ],
            marketCap: 1250000,
            volume24h: 45000,
          });
        }

        // Mock transactions
        setTransactions([
          {
            id: "1",
            type: "Received",
            amount: "500",
            asset: code,
            date: "2024-03-20 14:30",
            status: "Completed",
          },
          {
            id: "2",
            type: "Sent",
            amount: "120",
            asset: code,
            date: "2024-03-18 09:15",
            status: "Completed",
          },
          {
            id: "3",
            type: "Trade",
            amount: "250",
            asset: code,
            date: "2024-03-15 16:45",
            status: "Completed",
          },
          {
            id: "4",
            type: "Received",
            amount: "1000",
            asset: code,
            date: "2024-03-10 11:20",
            status: "Completed",
          },
        ]);

        // Mock sentiment
        const scores = [0.85, 0.45, -0.2, 0.6];
        const labels = ["Strong Bullish", "Neutral", "Bearish", "Bullish"];
        const idx = Math.floor(Math.random() * scores.length);
        setSentiment({ score: scores[idx], label: labels[idx] });
      } catch (err) {
        console.error("Error fetching asset details:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [code]);

  const valuation = priceData
    ? (parseFloat(balance) * priceData.price).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      })
    : "$0.00";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
        >
          <ArrowLeft
            size={20}
            className="group-hover:-translate-x-1 transition-transform"
          />
          Back to Portfolio
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Globe size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{code}</h1>
            {issuer && (
              <p className="text-xs text-gray-500 font-mono">
                {issuer.slice(0, 8)}...{issuer.slice(-8)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Balance & Valuation */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gradient-to-br from-gray-900 to-black border border-white/10 rounded-2xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Wallet size={120} />
            </div>

            <div className="relative z-10">
              <p className="text-gray-400 font-medium mb-2 flex items-center gap-2">
                <Wallet size={16} /> Current Balance
              </p>
              <h2 className="text-5xl font-bold mb-4 tracking-tight">
                {parseFloat(balance).toLocaleString()}{" "}
                <span className="text-2xl text-blue-400">{code}</span>
              </h2>
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-gray-500 text-sm mb-1">Total Valuation</p>
                  <p className="text-2xl font-semibold text-white">
                    {valuation}
                  </p>
                </div>
                {priceData && (
                  <div
                    className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-full mb-1 ${
                      priceData.change24h >= 0
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {priceData.change24h >= 0 ? (
                      <TrendingUp size={14} />
                    ) : (
                      <TrendingDown size={14} />
                    )}
                    {Math.abs(priceData.change24h).toFixed(2)}%
                  </div>
                )}
              </div>
            </div>

            {/* Sparkline background */}
            {priceData?.sparkline && (
              <div className="absolute bottom-0 left-0 w-full h-24 opacity-30 pointer-events-none">
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <path
                    d={`M 0 100 ${priceData.sparkline.map((v: number, i: number) => `L ${(i / (priceData.sparkline.length - 1)) * 100} ${100 - (v / Math.max(...priceData.sparkline)) * 80}`).join(" ")} L 100 100 Z`}
                    fill="url(#gradient)"
                  />
                  <defs>
                    <linearGradient
                      id="gradient"
                      x1="0%"
                      y1="0%"
                      x2="0%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            )}
          </div>

          {/* Activity Section */}
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Activity size={18} className="text-blue-400" />
                Recent Activity
              </h3>
              <button className="text-xs text-blue-400 hover:underline">
                View All
              </button>
            </div>
            <div className="divide-y divide-white/5">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-2 rounded-full ${
                        tx.type === "Received"
                          ? "bg-green-500/10 text-green-400"
                          : tx.type === "Sent"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {tx.type === "Received" ? (
                        <TrendingDown className="rotate-180" size={16} />
                      ) : tx.type === "Sent" ? (
                        <TrendingUp size={16} />
                      ) : (
                        <BarChart3 size={16} />
                      )}
                    </div>
                    <div>
                      <p className="font-medium">{tx.type}</p>
                      <p className="text-xs text-gray-500">{tx.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-semibold ${
                        tx.type === "Received"
                          ? "text-green-400"
                          : tx.type === "Sent"
                            ? "text-red-400"
                            : "text-white"
                      }`}
                    >
                      {tx.type === "Sent" ? "-" : "+"}
                      {parseFloat(tx.amount).toLocaleString()} {tx.asset}
                    </p>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider">
                      {tx.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Context & Sentiment */}
        <div className="space-y-6">
          {/* Sentiment Card */}
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider text-gray-400">
              <MessageSquare size={16} /> Market Sentiment
            </h3>
            <div className="text-center py-4">
              <div className="relative inline-flex items-center justify-center mb-4">
                <svg className="w-32 h-32 transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-gray-800"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="58"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={364.4}
                    strokeDashoffset={
                      364.4 - (364.4 * (sentiment.score + 1)) / 2
                    }
                    className={`${sentiment.score > 0 ? "text-green-500" : sentiment.score < 0 ? "text-red-500" : "text-yellow-500"}`}
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-bold">
                    {(sentiment.score * 100).toFixed(0)}%
                  </span>
                  <span className="text-[10px] text-gray-500 uppercase">
                    Score
                  </span>
                </div>
              </div>
              <p
                className={`text-xl font-bold ${
                  sentiment.score > 0.5
                    ? "text-green-400"
                    : sentiment.score > 0
                      ? "text-green-200"
                      : sentiment.score < -0.5
                        ? "text-red-400"
                        : "text-gray-400"
                }`}
              >
                {sentiment.label}
              </p>
              <p className="text-xs text-gray-500 mt-2 px-4">
                Based on social media mentions, news articles, and trade volume
                analysis.
              </p>
            </div>
          </div>

          {/* Market Info */}
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-wider text-gray-400">
              <BarChart3 size={16} /> Market Stats
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="text-gray-500 text-sm">Price</span>
                <span className="font-mono">
                  ${priceData?.price.toFixed(4)}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="text-gray-500 text-sm">Market Cap</span>
                <span className="font-mono">
                  ${(priceData?.marketCap / 1000000).toFixed(2)}M
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="text-gray-500 text-sm">Volume (24h)</span>
                <span className="font-mono">
                  ${(priceData?.volume24h / 1000).toFixed(2)}K
                </span>
              </div>
              <div className="pt-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-500 text-xs uppercase">
                    Allocation
                  </span>
                  <span className="text-blue-400 text-xs font-bold">12.5%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full"
                    style={{ width: "12.5%" }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
