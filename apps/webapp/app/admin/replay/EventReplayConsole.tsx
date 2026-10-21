'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, Eye } from 'lucide-react';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useExplorerUrl } from '@/hooks/useExplorerUrl';
import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

/**
 * Soroban event replay console.
 *
 * `POST /soroban-events/replay` reprocesses a ledger range for a contract, and
 * supports `dryRun`. The dry run is the important part of this screen: it is the
 * only way to find out what a range *would* touch before writing, so the
 * execute path is gated behind a dry run rather than merely preceded by one.
 *
 * The backend reports one aggregate (`totalEvents`, `indexed`, `skipped`) rather
 * than per-event outcomes, so the confirmation restates that count before the
 * write is allowed. The UI does not invent a per-entry breakdown the API does
 * not provide.
 */

interface ReplayResult {
  totalEvents: number;
  indexed: number;
  skipped: number;
  dryRun: boolean;
  startLedger: number;
  endLedger: number;
  contractId: string | null;
  summary: string;
}

interface ReplayRecord extends ReplayResult {
  ranAt: string;
}

function isResult(value: unknown): value is ReplayResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'totalEvents' in value &&
    'summary' in value
  );
}

function parseLedgers(start: string, end: string): { startLedger: number; endLedger: number } | null {
  const startLedger = Number(start);
  const endLedger = Number(end);
  if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) return null;
  if (startLedger < 0 || endLedger < 0) return null;
  // An inverted range would silently match nothing, and "0 events matched" reads
  // like good news during an incident.
  if (endLedger < startLedger) return null;
  return { startLedger, endLedger };
}

export default function EventReplayConsole() {
  const { loading: authLoading, isAuthenticated } = useAuthGuard();
  const buildExplorerUrl = useExplorerUrl();

  const [startLedger, setStartLedger] = useState('');
  const [endLedger, setEndLedger] = useState('');
  const [contractId, setContractId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<ReplayResult | null>(null);
  const [executed, setExecuted] = useState<ReplayResult | null>(null);
  const [history, setHistory] = useState<ReplayRecord[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (withDryRun: boolean) => {
      const range = parseLedgers(startLedger, endLedger);
      if (!range) {
        setValidationError(
          'Enter a valid ledger range: whole numbers, with the end at or after the start.',
        );
        return;
      }
      setValidationError(null);
      setError(null);
      setIsRunning(true);
      try {
        const response = await fetch(`${API_BASE}/soroban-events/replay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            ...range,
            contractId: contractId.trim() || undefined,
            dryRun: withDryRun,
          }),
        });
        if (!response.ok) {
          throw new Error(`Replay request failed (${response.status} ${response.statusText})`);
        }
        const payload: unknown = await response.json();
        if (!isResult(payload)) {
          throw new Error('Replay returned an unexpected response shape.');
        }
        if (payload.dryRun) {
          setDryRun(payload);
          setExecuted(null);
        } else {
          setExecuted(payload);
          setDryRun(null);
          setConfirming(false);
          setHistory((prev) => [{ ...payload, ranAt: new Date().toISOString() }, ...prev].slice(0, 10));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Replay request failed');
      } finally {
        setIsRunning(false);
      }
    },
    [startLedger, endLedger, contractId],
  );

  if (authLoading) {
    return <p className="p-8 text-slate-400">Checking access…</p>;
  }

  if (!isAuthenticated) {
    return (
      <p className="p-8 text-slate-500">
        You must be signed in with an admin account to replay events.
      </p>
    );
  }

  const staleDryRun =
    dryRun !== null &&
    (dryRun.startLedger !== Number(startLedger) || dryRun.endLedger !== Number(endLedger));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Soroban event replay</h1>
        <p className="mt-1 text-sm text-slate-400">
          Reprocess a ledger range. Run a dry run first — the write is blocked until you confirm the
          result below.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-slate-800 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-400">First ledger</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={startLedger}
              onChange={(e) => setStartLedger(e.target.value)}
              placeholder="1000"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Last ledger (inclusive)</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={endLedger}
              onChange={(e) => setEndLedger(e.target.value)}
              placeholder="2000"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-400">Contract ID (optional)</span>
          <input
            type="text"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            placeholder="Leave blank to replay every contract in the range"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
          />
        </label>

        {validationError ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {validationError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={isRunning}
            className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:border-slate-400 disabled:opacity-50"
          >
            <Eye className="h-4 w-4" />
            {isRunning ? 'Running…' : 'Dry run'}
          </button>

          <button
            type="button"
            onClick={() => (staleDryRun ? null : setConfirming(true))}
            disabled={isRunning || dryRun === null || staleDryRun}
            title={staleDryRun ? 'Run a dry run for the current range first' : undefined}
            className="flex items-center gap-2 rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4" />
            Execute replay
          </button>
        </div>

        {dryRun === null ? (
          <p className="text-xs text-slate-500">
            Execute stays disabled until a dry run completes for the range above.
          </p>
        ) : null}
        {staleDryRun ? (
          <p className="text-xs text-amber-300">
            The range changed since the last dry run. Run it again before executing.
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {confirming && dryRun ? (
        <div className="space-y-3 rounded-lg border border-amber-700 bg-amber-950/30 p-4">
          <p className="text-sm font-semibold text-amber-200">
            This will write {dryRun.totalEvents - dryRun.skipped} new{' '}
            {dryRun.totalEvents - dryRun.skipped === 1 ? 'event' : 'events'} to the read model.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <dt className="text-amber-300/70">Range</dt>
            <dd className="font-mono text-amber-100">
              {dryRun.startLedger}–{dryRun.endLedger}
            </dd>
            <dt className="text-amber-300/70">Would index</dt>
            <dd className="text-amber-100">{dryRun.totalEvents - dryRun.skipped}</dd>
            <dt className="text-amber-300/70">Already present</dt>
            <dd className="text-amber-100">{dryRun.skipped}</dd>
            <dt className="text-amber-300/70">Contract</dt>
            <dd className="truncate font-mono text-amber-100">
              {dryRun.contractId ?? 'all'}
            </dd>
          </dl>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void run(false)}
              disabled={isRunning}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {isRunning ? 'Replaying…' : 'Confirm and replay'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-amber-700 px-3 py-1.5 text-sm hover:bg-amber-900/40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {dryRun ? (
        <section className="rounded-lg border border-slate-700 p-4 text-sm">
          <h2 className="font-semibold text-slate-200">Dry run result</h2>
          <p className="mt-1 text-slate-400">{dryRun.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <dt className="text-slate-500">Events in range</dt>
            <dd className="text-slate-300">{dryRun.totalEvents}</dd>
            <dt className="text-slate-500">Would write</dt>
            <dd className="text-slate-300">{dryRun.totalEvents - dryRun.skipped}</dd>
            <dt className="text-slate-500">Already indexed</dt>
            <dd className="text-slate-300">{dryRun.skipped}</dd>
            <dt className="text-slate-500">Nothing written</dt>
            <dd className="text-emerald-300">dry run only</dd>
          </dl>
        </section>
      ) : null}

      {executed ? (
        <section className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-4 text-sm">
          <h2 className="flex items-center gap-2 font-semibold text-emerald-200">
            <CheckCircle className="h-4 w-4" />
            Replay complete
          </h2>
          <p className="mt-1 text-emerald-100/80">{executed.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <dt className="text-emerald-300/70">Indexed</dt>
            <dd className="text-emerald-100">{executed.indexed}</dd>
            <dt className="text-emerald-300/70">Skipped as duplicate</dt>
            <dd className="text-emerald-100">{executed.skipped}</dd>
            <dt className="text-emerald-300/70">Range</dt>
            <dd className="font-mono text-emerald-100">
              {executed.startLedger}–{executed.endLedger}
            </dd>
            <dt className="text-emerald-300/70">Contract</dt>
            <dd className="truncate font-mono text-emerald-100">
              {executed.contractId ? (
                <a
                  href={buildExplorerUrl("contract", executed.contractId)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  {executed.contractId.slice(0, 8)}…
                </a>
              ) : (
                'all'
              )}
            </dd>
          </dl>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <RefreshCw className="h-4 w-4" />
          Recent replays
          <span className="text-xs font-normal text-slate-500">
            this session
          </span>
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">
            No replays run in this session yet. Replays from other operators are recorded in the
            audit log.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li
                key={`${h.ranAt}-${i}`}
                className="rounded border border-slate-800 p-3 text-xs text-slate-400"
              >
                <span className="font-mono text-slate-200">
                  {h.startLedger}–{h.endLedger}
                </span>
                {h.contractId ? (
                  <>
                    {' · '}
                    <a
                      href={buildExplorerUrl("contract", h.contractId)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono underline"
                    >
                      {h.contractId.slice(0, 8)}…
                    </a>
                  </>
                ) : (
                  ' · all contracts'
                )}
                {' · '}
                {h.indexed} indexed, {h.skipped} skipped ·{' '}
                <span title={h.ranAt}>{new Date(h.ranAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-600">
          Replays are attributed to the authenticated operator server-side and written to the
          audit log.
        </p>
      </section>
    </div>
  );
}
