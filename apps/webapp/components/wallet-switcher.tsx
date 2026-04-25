"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet, type Wallet } from "@/contexts/WalletContext";

const CHAIN_STYLES: Record<string, string> = {
  ETH: "bg-purple-100 text-purple-700",
  SOL:  "bg-amber-100 text-amber-700",
  BNB:  "bg-yellow-100 text-yellow-700",
  MATIC:"bg-indigo-100 text-indigo-700",
};

function initials(label: string) {
  return label.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function truncate(address: string) {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export function WalletSwitcher() {
  const { wallets, activeWallet, switchWallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // dismiss toast after 2s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!activeWallet || wallets.length < 2) return null;

  function handleSwitch(w: Wallet) {
    if (w.id === activeWallet!.id) { setOpen(false); return; }
    switchWallet(w.id);
    setToast(`Switched to ${w.label}`);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 transition-colors"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500 text-xs font-semibold text-white">
          {initials(activeWallet.label)}
        </span>
        <span className="max-w-[90px] truncate">{activeWallet.label}</span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/10 bg-[#0f1117] shadow-xl">
          <div className="border-b border-white/10 px-4 py-2">
            <p className="text-xs font-medium uppercase tracking-wider text-white/40">Switch wallet</p>
          </div>

          {wallets.map((w) => (
            <button
              key={w.id}
              onClick={() => handleSwitch(w)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                w.id === activeWallet.id ? "bg-teal-900/30" : ""
              }`}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-800 text-xs font-semibold text-teal-200">
                {initials(w.label)}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${w.id === activeWallet.id ? "text-teal-400" : "text-white"}`}>
                  {w.label}
                </p>
                <p className="font-mono text-xs text-white/40">{truncate(w.address)}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHAIN_STYLES[w.chain] ?? "bg-gray-100 text-gray-600"}`}>
                  {w.chain}
                </span>
                <span className="text-xs font-medium text-white/60">{w.balance}</span>
                {w.id === activeWallet.id && (
                  <span className="h-2 w-2 rounded-full bg-teal-400" />
                )}
              </div>
            </button>
          ))}

          <div className="border-t border-white/10">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white/50 hover:bg-white/5 hover:text-white transition-colors">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/20 text-lg">+</span>
              Link new wallet
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute right-0 top-full z-50 mt-14 flex items-center gap-2 rounded-lg bg-teal-900 px-4 py-2 text-sm text-teal-300 shadow-lg">
          <span className="h-2 w-2 rounded-full bg-teal-400" />
          {toast}
        </div>
      )}
    </div>
  );
}