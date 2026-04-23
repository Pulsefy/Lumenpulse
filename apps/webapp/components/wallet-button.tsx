"use client";

import { useState } from "react";
import { Wallet, Copy, ExternalLink, Check, LogOut } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import { cn } from "@/lib/utils";

interface AccountSummaryProps {
  address: string;
  network?: "testnet" | "mainnet";
  onDisconnect: () => void;
}

export function WalletButton({ className }: { className?: string }) {
  const { publicKey, status, connect, disconnect } = useStellarWallet();

  if (status === "connected" && publicKey) {
    return (
      <AccountSummary
        address={publicKey}
        onDisconnect={disconnect}
      />
    );
  }

  return (
    <button
      onClick={connect}
      disabled={status === "connecting"}
      className={cn(
        "relative rounded-lg px-4 py-2 font-medium flex items-center gap-2 transition-all duration-300",
        "bg-primary text-primary-foreground hover:opacity-90",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      <Wallet className="w-4 h-4" />
      {status === "connecting" ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}

export function AccountSummary({
  address,
  network = "testnet",
  onDisconnect,
}: AccountSummaryProps) {
  const [copied, setCopied] = useState(false);

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const explorerUrl =
    network === "mainnet"
      ? `https://stellar.expert/explorer/public/account/${address}`
      : `https://stellar.expert/explorer/testnet/account/${address}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const openExplorer = () => {
    window.open(explorerUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex items-center gap-1">
      {/* Account Summary Button */}
      <button
        className="relative rounded-lg px-3 py-2 font-medium flex items-center gap-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-[#db74cf]/70 hover:border-[#db74cf]"
        title={address}
      >
        <Wallet className="w-4 h-4 text-primary" />
        <span className="text-white font-mono text-sm">
          {truncateAddress(address)}
        </span>
      </button>

      {/* Copy Button */}
      <button
        onClick={handleCopy}
        className="relative rounded-lg p-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-white/20 hover:border-[#db74cf]/70 group"
        title="Copy address"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
        )}
      </button>

      {/* Explorer Button */}
      <button
        onClick={openExplorer}
        className="relative rounded-lg p-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-white/20 hover:border-[#db74cf]/70 group"
        title="View on Stellar Expert"
      >
        <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
      </button>

      {/* Disconnect Button */}
      <button
        onClick={onDisconnect}
        className="relative rounded-lg p-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-red-500/50 hover:border-red-500 group"
        title="Disconnect"
      >
        <LogOut className="w-4 h-4 text-red-400 group-hover:text-red-500 transition-colors" />
      </button>
    </div>
  );
}