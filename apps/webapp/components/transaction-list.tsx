"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Transaction = {
  id: string;
  type: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  from: string;
  to: string;
  date: string;
  status: string;
  transactionHash: string;
  memo?: string;
  fee?: string;
  description: string;
};

export default function TransactionList() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    async function fetchTransactions() {
      try {
        setLoading(true);
        setError("");

        const token = document.cookie
          .split("; ")
          .find((row) => row.startsWith("auth-token="))
          ?.split("=")[1];

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/transactions/history?limit=20`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch transactions");
        }

        const data = await res.json();
        setTransactions(data.transactions || []);
      } catch (err) {
        console.error(err);
        setError("Unable to load transactions");
      } finally {
        setLoading(false);
      }
    }

    fetchTransactions();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "pending":
        return "text-yellow-400";
      default:
        return "text-gray-400";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "payment":
        return "💸";
      case "swap":
        return "🔄";
      case "trustline":
        return "🔗";
      case "create_account":
        return "✨";
      case "account_merge":
        return "🔀";
      default:
        return "📝";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-sm p-4">{error}</div>;
  }

  if (transactions.length === 0) {
    return (
      <div className="text-gray-400 text-center p-8">
        No transactions found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transactions.map((tx) => (
        <div
          key={tx.id}
          onClick={() => router.push(`/transactions/${tx.id}`)}
          className="bg-gray-800 hover:bg-gray-750 p-4 rounded-lg cursor-pointer transition-colors border border-gray-700 hover:border-gray-600"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <span className="text-2xl">{getTypeIcon(tx.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">
                  {tx.description}
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  {formatDate(tx.date)}
                </p>
              </div>
            </div>
            <div className="text-right ml-4">
              <p className="text-white font-semibold">
                {tx.amount} {tx.assetCode}
              </p>
              <p className={`text-sm capitalize ${getStatusColor(tx.status)}`}>
                {tx.status}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
