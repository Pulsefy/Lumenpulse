"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  RefreshCcw,
  Repeat2,
} from "lucide-react";
import { backendFetch } from "@/lib/backend-client";
import type {
  StellarTransaction,
  StellarTransactionHistoryResponse,
  TransactionType,
} from "@/types/stellar-transactions";

function typeMeta(type: TransactionType) {
  switch (type) {
    case "payment":
      return { label: "Payment", Icon: Repeat2 };
    case "swap":
      return { label: "Swap", Icon: RefreshCcw };
    case "trustline":
      return { label: "Trustline", Icon: Link2 };
    case "create_account":
      return { label: "Create Account", Icon: ArrowUpRight };
    case "account_merge":
      return { label: "Account Merge", Icon: ArrowDownLeft };
    case "inflation":
      return { label: "Inflation", Icon: ArrowDownLeft };
    default:
      return { label: "Activity", Icon: Repeat2 };
  }
}

function formatAmount(amount: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString(undefined, { maximumFractionDigits: 7 });
}

function formatDate(date: string) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StellarTransactionHistoryPanel({
  publicKey,
  limit = 20,
}: {
  publicKey: string | null;
  limit?: number;
}) {
  const [transactions, setTransactions] = useState<StellarTransaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoadMore = Boolean(nextCursor);

  const fetchPage = async (cursor?: string) => {
    if (!publicKey) return;

    const qs = new URLSearchParams({
      publicKey,
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
    });

    const res = await backendFetch(`/stellar/transactions?${qs.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Failed to fetch transaction history");
    }

    return (await res.json()) as StellarTransactionHistoryResponse;
  };

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setTransactions([]);
        setNextCursor(undefined);

        const data = await fetchPage();
        if (cancelled || !data) return;

        setTransactions(data.transactions || []);
        setNextCursor(data.nextPage);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Unable to load activity";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, limit]);

  const handleLoadMore = async () => {
    if (!publicKey || !nextCursor || loadingMore) return;

    try {
      setLoadingMore(true);
      setError(null);
      const data = await fetchPage(nextCursor);
      if (!data) return;

      setTransactions((prev) => [...prev, ...(data.transactions || [])]);
      setNextCursor(data.nextPage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to load more activity";
      setError(msg);
    } finally {
      setLoadingMore(false);
    }
  };

  const emptyState = useMemo(() => {
    if (!publicKey) return "No wallet connected";
    if (loading) return "Loading activity...";
    if (error) return error;
    if (transactions.length === 0) return "No recent activity found";
    return null;
  }, [publicKey, loading, error, transactions.length]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Recent Activity</h2>
        {publicKey ? (
          <span className="text-xs text-white/50">
            {publicKey.slice(0, 6)}...{publicKey.slice(-4)}
          </span>
        ) : null}
      </div>

      {emptyState ? (
        <p className={error ? "text-red-400 text-sm" : "text-gray-400"}>
          {emptyState}
        </p>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => {
            const { Icon, label } = typeMeta(tx.type);
            return (
              <div
                key={tx.id}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-colors"
              >
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-black/30 border border-white/10">
                  <Icon className="h-4 w-4 text-[#db74cf]" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {tx.description || label}
                      </p>
                      <p className="text-xs text-white/50 mt-0.5">
                        {formatDate(tx.date)} • {label}
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-white">
                        {formatAmount(tx.amount)} {tx.assetCode}
                      </p>
                      <p
                        className={[
                          "text-xs mt-0.5",
                          tx.status === "success"
                            ? "text-green-400"
                            : tx.status === "failed"
                              ? "text-red-400"
                              : "text-yellow-400",
                        ].join(" ")}
                      >
                        {tx.status}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {canLoadMore ? (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

