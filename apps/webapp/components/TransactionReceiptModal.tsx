"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, Loader2, AlertCircle, ExternalLink, Copy, CheckCheck } from "lucide-react";
import { useState } from "react";
import { getExplorerUrl } from "@/lib/utils";

export interface TransactionReceiptModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  status: "pending" | "confirmed" | "error";
  txHash: string | null;
  amount: string;
  projectId: number;
  timestamp?: string | null;
  errorMessage?: string | null;
}

export function TransactionReceiptModal({
  isOpen,
  onOpenChange,
  status,
  txHash,
  amount,
  projectId,
  timestamp,
  errorMessage,
}: TransactionReceiptModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedTime = timestamp ? new Date(timestamp).toLocaleString() : null;

  const isError = status === "error";
  const isPending = status === "pending";

  const iconBg = isError
    ? "bg-red-500/20 text-red-400"
    : isPending
    ? "bg-amber-500/20 text-amber-400"
    : "bg-emerald-500/20 text-emerald-400";

  const title = isError
    ? "Transaction Failed"
    : isPending
    ? "Transaction Pending"
    : "Contribution Confirmed!";

  const description = isError
    ? (errorMessage ?? "The transaction could not be completed. Please try again.")
    : isPending
    ? "Your Stellar transaction is currently being processed on the network."
    : `You have successfully contributed to Project #${projectId}.`;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-zinc-950 p-6 shadow-xl sm:rounded-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <div className="flex flex-col items-center gap-4 text-center">
            {/* Icon */}
            <div className={`relative flex h-16 w-16 items-center justify-center rounded-full ${iconBg}`}>
              {isPending && <Loader2 className="h-8 w-8 animate-spin" />}
              {status === "confirmed" && <Check className="h-8 w-8" />}
              {isError && <AlertCircle className="h-8 w-8" />}
            </div>

            {/* Title & Description */}
            <div className="space-y-1">
              <Dialog.Title className="text-xl font-semibold text-white">
                {title}
              </Dialog.Title>
              <Dialog.Description className={`text-sm ${isError ? "text-red-400" : "text-zinc-400"}`}>
                {description}
              </Dialog.Description>
            </div>
          </div>

          {/* Details Card */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm mt-2">
            {/* Network */}
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-zinc-500">Network</span>
              <span className="text-zinc-300">Stellar Testnet</span>
            </div>

            {/* Timestamp */}
            {formattedTime && (
              <div className="flex justify-between py-2 border-b border-white/5">
                <span className="text-zinc-500">Timestamp</span>
                <span className="text-zinc-300">{formattedTime}</span>
              </div>
            )}

            {/* Amount */}
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-zinc-500">Amount</span>
              <span className="font-semibold text-white">{amount} XLM</span>
            </div>

            {/* Project */}
            <div className={`flex justify-between py-2 ${txHash ? "border-b border-white/5" : ""}`}>
              <span className="text-zinc-500">Project</span>
              <span className="font-semibold text-white">#{projectId}</span>
            </div>

            {/* TX Hash with copy */}
            {txHash && (
              <div className="flex justify-between py-2 items-center">
                <span className="text-zinc-500">Hash</span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={getExplorerUrl("tx", txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 font-mono text-primary hover:underline text-xs"
                  >
                    {txHash.substring(0, 8)}...{txHash.substring(56)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    onClick={handleCopy}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title={copied ? "Copied!" : "Copy hash"}
                  >
                    {copied
                      ? <CheckCheck className="h-3 w-3 text-emerald-400" />
                      : <Copy className="h-3 w-3 text-zinc-400" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Explorer link (prominent, success only) */}
          {status === "confirmed" && txHash && (
            <a
              href={getExplorerUrl("tx", txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-sm text-primary hover:underline"
            >
              View on Stellar Explorer
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          {/* Action */}
          <div className="mt-2 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-black transition-colors hover:bg-primary/90 focus:outline-none">
                {isPending ? "Close" : "Done"}
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
