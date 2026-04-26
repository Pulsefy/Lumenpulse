"use client";

import {
  X,
  Copy,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
} from "lucide-react";
import { useState } from "react";

interface Transaction {
  id: string;
  hash: string;
  type: "Received" | "Sent" | "Trade";
  amount: string;
  asset: string;
  date: string;
  status: "Completed" | "Pending" | "Failed";
  from: string;
  to: string;
  fee: string;
  ledger: number;
  memo?: string;
}

interface TransactionDetailProps {
  transaction: Transaction;
  onClose: () => void;
}

export default function TransactionDetail({
  transaction,
  onClose,
}: TransactionDetailProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getExplorerUrl = (hash: string) => {
    return `https://stellar.expert/explorer/public/tx/${hash}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Completed":
        return <CheckCircle2 size={18} className="text-green-400" />;
      case "Pending":
        return <Clock size={18} className="text-yellow-400 animate-pulse" />;
      case "Failed":
        return <AlertCircle size={18} className="text-red-400" />;
      default:
        return null;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "Received":
        return <ArrowDownLeft size={24} className="text-green-400" />;
      case "Sent":
        return <ArrowUpRight size={24} className="text-red-400" />;
      case "Trade":
        return <ArrowLeftRight size={24} className="text-blue-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg bg-gray-900/90 border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Glow Effect */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl pointer-events-none"></div>

        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/5 rounded-2xl">
              {getTypeIcon(transaction.type)}
            </div>
            <div>
              <h2 className="text-xl font-bold">{transaction.type}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                {getStatusIcon(transaction.status)}
                <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
                  {transaction.status}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 relative z-10">
          {/* Amount Section */}
          <div className="text-center py-4 bg-white/5 rounded-2xl border border-white/5">
            <p className="text-gray-500 text-sm mb-1 uppercase tracking-wider">Amount</p>
            <h3 className="text-4xl font-bold tracking-tight">
              {transaction.type === "Sent" ? "-" : "+"}
              {transaction.amount}{" "}
              <span className="text-blue-400">{transaction.asset}</span>
            </h3>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Transaction Hash</p>
              <div className="flex items-center justify-between gap-2 p-3 bg-black/40 rounded-xl border border-white/5 group">
                <code className="text-xs text-blue-300 truncate font-mono">
                  {transaction.hash}
                </code>
                <button
                  onClick={() => copyToClipboard(transaction.hash)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-colors shrink-0"
                  title="Copy Hash"
                >
                  {copied ? (
                    <CheckCircle2 size={14} className="text-green-400" />
                  ) : (
                    <Copy size={14} className="text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">From</p>
                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-sm font-mono truncate text-gray-300">{transaction.from}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">To</p>
                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-sm font-mono truncate text-gray-300">{transaction.to}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Fee</p>
                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-sm text-gray-300">{transaction.fee}</p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Ledger</p>
                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-sm text-gray-300">{transaction.ledger}</p>
                </div>
              </div>
            </div>

            {transaction.memo && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Memo</p>
                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-sm text-gray-300 italic">"{transaction.memo}"</p>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Date & Time</p>
              <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                <p className="text-sm text-gray-300">{transaction.date}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-white/5 relative z-10">
          <a
            href={getExplorerUrl(transaction.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-500/20"
          >
            View on Stellar.expert
            <ExternalLink size={18} />
          </a>
        </div>
      </div>
    </div>
  );
}
