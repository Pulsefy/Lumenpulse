"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import { cn } from "@/lib/utils";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function AccountSummary({
  address,
  onDisconnect,
}: {
  address: string;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const short = useMemo(() => truncateAddress(address), [address]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        title="Copy address"
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-white/70" />
        )}
        <span className="font-medium">{short}</span>
      </button>

      <a
        href={`https://stellar.expert/explorer/account/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        title="View on explorer"
        className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ExternalLink className="h-4 w-4" />
      </a>

      <button
        type="button"
        onClick={onDisconnect}
        title="Disconnect wallet"
        className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function WalletButton({ className }: { className?: string }) {
  const { publicKey, status, connect, disconnect, error, errorType, resetError } =
    useStellarWallet();

  const isConnecting = status === "connecting";
  const showInstall =
    status === "missing_extension" || errorType === "missing_extension";

  if (status === "connected" && publicKey) {
    return <AccountSummary address={publicKey} onDisconnect={disconnect} />;
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (showInstall) {
            window.open("https://www.freighter.app/", "_blank", "noopener,noreferrer");
            return;
          }
          if (status === "rejected") resetError();
          void connect();
        }}
        disabled={isConnecting}
        className={cn(
          "relative rounded-lg px-4 py-2 font-medium flex items-center gap-2 transition-all duration-300",
          "bg-primary text-primary-foreground hover:opacity-90",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <Wallet className="w-4 h-4" />
        {showInstall
          ? "Install Freighter"
          : isConnecting
            ? "Connecting..."
            : status === "rejected"
              ? "Connection rejected — try again"
              : "Connect Wallet"}
      </button>

      {error ? (
        <div className="text-xs text-red-400">
          {errorType === "rejected" ? (
            <>
              You declined the request. Click “Connect Wallet” to try again.
            </>
          ) : (
            error
          )}
        </div>
      ) : null}
    </div>
  );
}

