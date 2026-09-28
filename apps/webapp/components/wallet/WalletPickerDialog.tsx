"use client";

import { useEffect } from "react";
import { Wallet, X } from "lucide-react";

export interface WalletPickerOption {
  id: string;
  name: string;
}

interface WalletPickerDialogProps {
  open: boolean;
  options: WalletPickerOption[];
  lastUsedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function WalletPickerDialog({
  open,
  options,
  lastUsedId,
  onSelect,
  onClose,
}: WalletPickerDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="wallet-picker-title" className="text-base font-semibold">
            Choose a wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet picker"
            className="p-1 rounded text-foreground/50 hover:text-foreground hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-2">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onSelect(option.id)}
                className="w-full flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left text-sm font-medium hover:bg-white/[0.06] transition-colors"
              >
                <Wallet className="w-4 h-4 text-primary" />
                <span className="flex-1">{option.name}</span>
                {option.id === lastUsedId && (
                  <span className="text-[10px] uppercase tracking-wider text-foreground/40">
                    Last used
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
