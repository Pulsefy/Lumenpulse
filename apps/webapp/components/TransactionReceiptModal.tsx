"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, Loader2, ExternalLink } from "lucide-react";
import { getExplorerUrl } from "@/lib/utils";

export interface TransactionReceiptModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  status: "pending" | "confirmed" | "error";
  txHash: string | null;
  amount: string;
  projectId: number;
}

export function TransactionReceiptModal({
  isOpen,
  onOpenChange,
  status,
  txHash,
  amount,
  projectId,
}: TransactionReceiptModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-zinc-950 p-6 shadow-xl sm:rounded-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <div className="flex flex-col items-center gap-4 text-center">
            {/* Icon */}
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full">
              {status === "pending" && (
                <div className="absolute inset-0 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              )}
              {status === "confirmed" && (
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Check className="h-8 w-8" />
                </div>
              )}
            </div>

            {/* Title & Description */}
            <div className="space-y-1">
              <Dialog.Title className="text-xl font-semibold text-white">
                {status === "pending" ? "Transaction Pending" : "Contribution Confirmed!"}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-400">
                {status === "pending"
                  ? "Your Stellar transaction is currently being processed on the network."
                  : `You have successfully contributed to Project #${projectId}.`}
              </Dialog.Description>
            </div>
          </div>

          {/* Details Card */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm mt-2">
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-zinc-500">Amount</span>
              <span className="font-semibold text-white">{amount} XLM</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-zinc-500">Project</span>
              <span className="font-semibold text-white">#{projectId}</span>
            </div>
            {txHash && (
              <div className="flex justify-between py-2 items-center">
                <span className="text-zinc-500">Hash</span>
                <a
                  href={getExplorerUrl("tx", txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-primary hover:underline text-xs"
                >
                  {txHash.substring(0, 8)}...{txHash.substring(48)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Action */}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-black transition-colors hover:bg-primary/90 focus:outline-none"
              >
                {status === "pending" ? "Close" : "Done"}
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
