"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Transaction } from "@/components/transaction-list";

type TransactionDetail = Transaction & {
  network?: string;
  ledger?: number;
  operationCount?: number;
  sourceAccount?: string;
  signatureCount?: number;
};

export default function TransactionDetailPage() {
  const [transaction, setTransaction] = useState<TransactionDetail | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  useEffect(() => {
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/transactions");
      return;
    }

    async function fetchTransactionDetail() {
      try {
        setLoading(true);
        setError("");

        const token = document.cookie
          .split("; ")
          .find((row) => row.startsWith("auth-token="))
          ?.split("=")[1];

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/transactions/${id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch transaction details");
        }

        const data = await res.json();
        setTransaction(data);
      } catch (err) {
        console.error(err);
        setError("Unable to load transaction details");
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchTransactionDetail();
    }
  }, [id, router]);

  const getExplorerUrl = (hash: string, network?: string) => {
    const isTestnet = network === "testnet";
    const baseUrl = isTestnet
      ? "https://stellar.expert/explorer/testnet"
      : "https://stellar.expert/explorer/public";
    return `${baseUrl}/tx/${hash}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const shortenAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-500/20 text-green-400 border-green-500/50";
      case "failed":
        return "bg-red-500/20 text-red-400 border-red-500/50";
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => router.back()}
            className="text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back
          </button>
          <div className="text-red-400">{error || "Transaction not found"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => router.back()}
          className="text-blue-400 hover:text-blue-300 mb-6 flex items-center space-x-2"
        >
          <span>←</span>
          <span>Back to Transactions</span>
        </button>

        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <div className="p-6 border-b border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold">Transaction Details</h1>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                  transaction.status
                )}`}
              >
                {transaction.status.toUpperCase()}
              </span>
            </div>
            <p className="text-gray-400">{transaction.description}</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  Amount
                </label>
                <p className="text-xl font-semibold text-white">
                  {transaction.amount} {transaction.assetCode}
                </p>
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  Type
                </label>
                <p className="text-xl font-semibold text-white capitalize">
                  {transaction.type.replace("_", " ")}
                </p>
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  Date
                </label>
                <p className="text-white">
                  {new Date(transaction.date).toLocaleString()}
                </p>
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-2">Fee</label>
                <p className="text-white">
                  {transaction.fee ? `${transaction.fee} stroops` : "N/A"}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-6">
              <h2 className="text-lg font-semibold mb-4">Transaction Hash</h2>
              <div className="flex items-center space-x-2 bg-gray-800 p-3 rounded">
                <code className="text-sm text-gray-300 flex-1 overflow-x-auto">
                  {transaction.transactionHash}
                </code>
                <button
                  onClick={() => copyToClipboard(transaction.transactionHash)}
                  className="text-blue-400 hover:text-blue-300 px-3 py-1 text-sm"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  From
                </label>
                <div className="flex items-center space-x-2 bg-gray-800 p-3 rounded">
                  <code className="text-sm text-gray-300 flex-1">
                    {shortenAddress(transaction.from)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(transaction.from)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-2">To</label>
                <div className="flex items-center space-x-2 bg-gray-800 p-3 rounded">
                  <code className="text-sm text-gray-300 flex-1">
                    {shortenAddress(transaction.to)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(transaction.to)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            {transaction.assetIssuer && (
              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  Asset Issuer
                </label>
                <div className="flex items-center space-x-2 bg-gray-800 p-3 rounded">
                  <code className="text-sm text-gray-300 flex-1">
                    {shortenAddress(transaction.assetIssuer)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(transaction.assetIssuer!)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            {transaction.memo && (
              <div>
                <label className="text-gray-400 text-sm block mb-2">
                  Memo
                </label>
                <p className="text-white bg-gray-800 p-3 rounded">
                  {transaction.memo}
                </p>
              </div>
            )}

            {transaction.ledger && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-gray-400 text-sm block mb-2">
                    Ledger
                  </label>
                  <p className="text-white">{transaction.ledger}</p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-2">
                    Operations
                  </label>
                  <p className="text-white">
                    {transaction.operationCount || 1}
                  </p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-2">
                    Signatures
                  </label>
                  <p className="text-white">
                    {transaction.signatureCount || 1}
                  </p>
                </div>
              </div>
            )}

            <div className="border-t border-gray-800 pt-6">
              <a
                href={getExplorerUrl(
                  transaction.transactionHash,
                  transaction.network
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                <span>View on Stellar Explorer</span>
                <span>↗</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
