'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, ChevronDown, ChevronRight, Database } from 'lucide-react';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

/**
 * Dead-letter console.
 *
 * Two independent queues poison independently and need recovering separately:
 *
 *   - `outbox/dead-letter`         — side effects that exhausted dispatch attempts
 *   - `soroban-events/dead-letter` — ledger events that failed processing
 *
 * They are shown as two tabs rather than one merged list because their fields
 * barely overlap: an outbox row has an event type and a payload, a Soroban row
 * has a contract, a ledger sequence and a typed error history. Merging them would
 * mean nulling out half the columns and an operator would not know which queue a
 * replay targets.
 *
 * Failure is never papered over with placeholder data. `AuditLogsClient` falls
 * back to mock rows when its fetch fails, which is harmless for a read-only log
 * view and actively harmful here: during an incident, a fabricated dead-letter
 * list would send an operator replaying entries that do not exist.
 */

type Source = 'outbox' | 'soroban-events';

interface OutboxEntry {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deadLetterAt: string | null;
}

interface SorobanEntry {
  id: string;
  sorobanEventId: string | null;
  txHash: string;
  eventIndex: number;
  contractId: string | null;
  eventType: string | null;
  canonicalType: string | null;
  category: string | null;
  rawPayload: Record<string, unknown>;
  ledgerSequence: number | null;
  failureCount: number;
  lastErrorMessage: string | null;
  status: string;
  replayCount: number;
  createdAt: string;
}

interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ReplayResult {
  id: string;
  ok: boolean;
  message: string;
}

const SOURCES: Record<Source, { label: string; list: string; item: string; replay: string }> = {
  outbox: {
    label: 'Outbox',
    list: '/outbox/dead-letter',
    item: '/outbox/dead-letter',
    replay: '/outbox/dead-letter',
  },
  'soroban-events': {
    label: 'Soroban events',
    list: '/soroban-events/dead-letter',
    item: '/soroban-events/dead-letter',
    replay: '/soroban-events/dead-letter',
  },
};

/** Human-readable age, so a six-hour-old poison is distinguishable from a six-day-old one. */
function formatAge(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function DeadLetterConsole() {
  const { loading: authLoading, isAuthenticated } = useAuthGuard();
  const [source, setSource] = useState<Source>('outbox');
  const [page, setPage] = useState(0);
  const [limit] = useState(20);
  const [data, setData] = useState<Page<OutboxEntry | SorobanEntry> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<OutboxEntry | SorobanEntry | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ReplayResult[]>([]);
  const [replaying, setReplaying] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}${SOURCES[source].list}?page=${page}&limit=${limit}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Failed to load dead letters (${response.status})`);
      }
      setData((await response.json()) as Page<OutboxEntry | SorobanEntry>);
      setSelected([]);
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dead letters');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [source, page, limit]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      void load();
    }
  }, [authLoading, isAuthenticated, load]);

  const inspect = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    setDetailError(null);
    try {
      const response = await fetch(`${API_BASE}${SOURCES[source].item}/${id}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed to inspect entry (${response.status})`);
      setDetail((await response.json()) as OutboxEntry | SorobanEntry);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to inspect entry');
    }
  };

  const replayOne = async (id: string): Promise<ReplayResult> => {
    try {
      const response = await fetch(`${API_BASE}${SOURCES[source].replay}/${id}/replay`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { id, ok: false, message: `${response.status} ${response.statusText}` };
      }
      return { id, ok: true, message: 'Replayed' };
    } catch (err) {
      return { id, ok: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
  };

  /**
   * Replays are sequential and each one is reported on its own line. A bulk
   * replay that returns a single "3 of 3 succeeded" would hide which entry
   * poisoned the batch, which is the only reason the operator ran it.
   */
  const replaySelected = async () => {
    setReplaying(true);
    const outcome: ReplayResult[] = [];
    for (const id of selected) {
      outcome.push(await replayOne(id));
    }
    setResults(outcome);
    setReplaying(false);
    setConfirming(false);
    setSelected([]);
    void load();
  };

  if (authLoading) {
    return <p className="p-8 text-slate-400">Checking access…</p>;
  }

  if (!isAuthenticated) {
    return (
      <p className="p-8 text-slate-500">
        You must be signed in with an admin account to view dead letters.
      </p>
    );
  }

  const entries = data?.data ?? [];
  const failed = results.filter((r) => !r.ok).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dead letters</h1>
          <p className="mt-1 text-sm text-slate-400">
            Messages that exhausted their attempts. Replay is attributed to your account in the audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <div role="tablist" aria-label="Dead letter source" className="flex gap-2">
        {(Object.keys(SOURCES) as Source[]).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={source === key}
            onClick={() => {
              setSource(key);
              setPage(0);
              setExpanded(null);
              setDetail(null);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              source === key
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {SOURCES[key].label}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">
          <span>{selected.length} selected</span>
          {confirming ? (
            <>
              <span className="font-semibold">
                Replay {selected.length} {selected.length === 1 ? 'entry' : 'entries'} now?
              </span>
              <button
                type="button"
                onClick={() => void replaySelected()}
                disabled={replaying}
                className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {replaying ? 'Replaying…' : 'Confirm replay'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-amber-700 px-3 py-1.5 hover:bg-amber-900/40"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
            >
              Replay selected…
            </button>
          )}
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="rounded-lg border border-slate-700 p-4 text-sm">
          <p className="font-semibold text-slate-200">
            Replay finished: {results.length - failed} succeeded, {failed} failed.
          </p>
          <ul className="mt-2 space-y-1">
            {results.map((r) => (
              <li key={r.id} className="flex items-center gap-2 font-mono text-xs">
                {r.ok ? (
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                )}
                <span className={r.ok ? 'text-emerald-300' : 'text-red-300'}>
                  {r.id.slice(0, 8)} — {r.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!error && !isLoading && entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-800 p-12 text-center">
          <Database className="h-8 w-8 text-slate-600" />
          <p className="text-slate-400">No dead-lettered entries in this queue.</p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {entries.map((raw) => {
          // The two queues share an id but nothing else, so narrow on a field
          // only one of them has rather than on which tab is open.
          const entry: OutboxEntry | SorobanEntry = raw;
          const soroban = 'failureCount' in entry ? entry : null;
          const outbox = 'failureCount' in entry ? null : entry;

          const id = entry.id;
          const attempts = soroban ? soroban.failureCount : outbox?.attempts ?? 0;
          const failure = soroban ? soroban.lastErrorMessage : outbox?.lastError ?? null;
          const title = soroban
            ? `${soroban.contractId ?? 'unknown contract'} · ${soroban.canonicalType ?? soroban.eventType ?? 'event'}`
            : (outbox?.eventType ?? 'event');
          const stamp = soroban ? soroban.createdAt : outbox?.deadLetterAt ?? null;

          return (
            <li key={id} className="rounded-lg border border-slate-800">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${id}`}
                  checked={selected.includes(id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                    )
                  }
                  className="h-4 w-4 rounded border-slate-600"
                />
                <button
                  type="button"
                  onClick={() => void inspect(id)}
                  aria-expanded={expanded === id}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {expanded === id ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-200">
                      {title}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-500">{id}</span>
                  </span>
                </button>
                <span className="shrink-0 text-xs text-slate-400">
                  {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
                </span>
                <span
                  className="shrink-0 text-xs text-slate-400"
                  title={stamp ?? undefined}
                >
                  age {formatAge(stamp)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected([id]);
                    setConfirming(true);
                  }}
                  className="shrink-0 rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-indigo-500 hover:text-indigo-300"
                >
                  Replay
                </button>
              </div>

              {failure ? (
                <p className="border-t border-slate-800 px-3 py-2 text-xs text-red-300">
                  {failure}
                </p>
              ) : null}

              {expanded === id ? (
                <div className="border-t border-slate-800 p-3">
                  {detailError ? (
                    <p role="alert" className="text-xs text-red-300">
                      {detailError}
                    </p>
                  ) : null}
                  {!detail && !detailError ? (
                    <p className="text-xs text-slate-500">Loading payload…</p>
                  ) : null}
                  {detail ? (() => {
                    const d = detail;
                    const dSoroban = 'replayCount' in d ? d : null;
                    const dOutbox = 'replayCount' in d ? null : d;
                    const payload = dSoroban ? dSoroban.rawPayload : dOutbox?.payload;
                    return (
                    <div className="space-y-3">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                        <dt className="text-slate-500">Status</dt>
                        <dd className="text-slate-300">{d.status}</dd>
                        {dSoroban ? (
                          <>
                            <dt className="text-slate-500">Replayed</dt>
                            <dd className="text-slate-300">{dSoroban.replayCount}×</dd>
                          </>
                        ) : null}
                        {dOutbox ? (
                          <>
                            <dt className="text-slate-500">Correlation</dt>
                            <dd className="truncate font-mono text-slate-300">
                              {dOutbox.correlationId ?? '—'}
                            </dd>
                          </>
                        ) : null}
                        {dSoroban ? (
                          <>
                            <dt className="text-slate-500">Ledger</dt>
                            <dd className="text-slate-300">{dSoroban.ledgerSequence ?? '—'}</dd>
                          </>
                        ) : null}
                      </dl>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-400">Payload</p>
                        <pre className="max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-300">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                    );
                  })() : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {data && data.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-slate-400">
            Page {data.page + 1} of {data.totalPages} · {data.total} entries
          </span>
          <button
            type="button"
            disabled={page + 1 >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
