"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import { cn } from "@/lib/utils";

interface WalletButtonProps {
  className?: string;
}

interface AccountSummaryProps {
  address: string;
  onDisconnect: () => void;
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function WalletButton({ className }: WalletButtonProps) {
export function WalletButton({ className }: { className?: string }) {
  const { publicKey, status, connect, disconnect } = useStellarWallet();

  if (status === "connected" && publicKey) {
    return <AccountSummary address={publicKey} onDisconnect={disconnect} />;
  }

  return (
    <button
      onClick={() => void connect()}
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

export function AccountSummary({ address, onDisconnect }: AccountSummaryProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
        <Wallet className="h-4 w-4 text-primary" />
        <span className="font-mono">{truncateAddress(address)}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-white/50 transition-colors hover:text-white"
          aria-label="Copy wallet address"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <a
          href={`https://stellar.expert/explorer/testnet/account/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/50 transition-colors hover:text-white"
          aria-label="View wallet on StellarExpert"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <button
        type="button"
        onClick={onDisconnect}
        className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-red-300 transition-colors hover:bg-red-500/20"
        aria-label="Disconnect wallet"
      >
        <LogOut className="h-4 w-4" />
interface AccountSummaryProps {
  address: string;
  onDisconnect: () => void;
}

export function AccountSummary({
  address,
  onDisconnect,
}: AccountSummaryProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy address", err);
    }
  };

  return (
    <div className="flex items-center gap-2 bg-gray-900 border border-white/10 rounded-lg p-1.5 pl-3">
      <span className="text-sm font-mono text-gray-300">
        {address.slice(0, 6)}...{address.slice(-4)}
      </span>
      
      <button
        onClick={copyAddress}
        className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
        title="Copy address"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      <a
        href={`https://stellar.expert/explorer/testnet/account/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
        title="View on Stellar.expert"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>

      <button
        onClick={onDisconnect}
        className="p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors ml-1"
        title="Disconnect"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
