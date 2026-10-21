'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Flag,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentUserRole, type UserRole } from '@/lib/auth-role';
import {
  FeatureFlagsApiService,
  SensitiveConfirmationRequiredError,
  describeTargeting,
  type FeatureFlag,
  type FlagChange,
} from '@/lib/feature-flags-service';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { ListError } from '@/components/ui/list-error';
import { EmptyState } from '@/components/ui/empty-state';
import SensitiveConfirmDialog from './SensitiveConfirmDialog';
import FlagHistory from './FlagHistory';

interface PendingChange {
  flag: FeatureFlag;
  change: FlagChange;
  label: string;
}

type RowStatus = { type: 'success' | 'error'; message: string } | null;

export default function FeatureFlagsConsoleClient() {
  // undefined = not read yet (the token cookie is only readable client-side).
  const [role, setRole] = useState<UserRole | null | undefined>(undefined);
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [historyVersion, setHistoryVersion] = useState<Record<string, number>>({});

  useEffect(() => {
    setRole(getCurrentUserRole());
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setFlags(null);
    try {
      setFlags(await FeatureFlagsApiService.listFlags());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load flags');
    }
  }, []);

  useEffect(() => {
    if (role === 'admin') void load();
  }, [role, load]);

  const apply = useCallback(
    async (flag: FeatureFlag, change: FlagChange, label: string, confirm: boolean) => {
      setSubmittingKey(flag.key);
      setRowStatus((s) => ({ ...s, [flag.key]: null }));
      try {
        const saved = await FeatureFlagsApiService.updateFlag(flag, change, { confirm });
        setFlags((list) => list?.map((f) => (f.key === saved.key ? saved : f)) ?? list);
        setHistoryVersion((v) => ({ ...v, [flag.key]: (v[flag.key] ?? 0) + 1 }));
        setRowStatus((s) => ({ ...s, [flag.key]: { type: 'success', message: `Saved: ${label}` } }));
        setPending(null);
      } catch (err) {
        if (err instanceof SensitiveConfirmationRequiredError) {
          // The flag was marked sensitive after this page loaded; collect the
          // confirmation instead of failing the change.
          const marked = { ...flag, sensitive: true };
          setFlags((list) => list?.map((f) => (f.key === flag.key ? marked : f)) ?? list);
          setPending({ flag: marked, change, label });
        } else {
          setPending(null);
          setRowStatus((s) => ({
            ...s,
            [flag.key]: {
              type: 'error',
              message: err instanceof Error ? err.message : 'Change failed',
            },
          }));
        }
      } finally {
        setSubmittingKey(null);
      }
    },
    [],
  );

  const requestChange = useCallback(
    (flag: FeatureFlag, change: FlagChange, label: string) => {
      if (flag.sensitive) {
        setPending({ flag, change, label });
        return;
      }
      void apply(flag, change, label, false);
    },
    [apply],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!flags) return [];
    return q ? flags.filter((f) => f.key.toLowerCase().includes(q)) : flags;
  }, [flags, query]);

  if (role === undefined) {
    return <div className="p-6 text-center text-foreground/50">Checking permissions…</div>;
  }

  if (role !== 'admin') {
    return (
      <div className="min-h-screen pt-24 px-4">
        <div className="container mx-auto max-w-md text-center">
          <Lock className="w-10 h-10 mx-auto text-foreground/30" />
          <h1 className="mt-4 text-xl font-bold">Admin access required</h1>
          <p className="mt-2 text-sm text-foreground/50">
            The feature flag console is only available to administrators.
          </p>
          <Link href="/" className="mt-4 inline-block text-primary hover:underline text-sm">
            Return home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <section className="relative pt-24 pb-6 px-4">
        <div className="container mx-auto max-w-5xl">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70"
          >
            <ArrowLeft className="w-3 h-3" /> Admin Console
          </Link>
          <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Flag className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Feature Flags</h1>
                <p className="text-foreground/50 text-base">
                  Toggle flags, adjust rollouts and review who changed what
                </p>
              </div>
            </div>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors"
            >
              <RefreshCw className={cn('w-4 h-4', flags === null && !loadError && 'animate-spin')} />
              Refresh
            </button>
          </div>
          <label className="mt-6 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <Search className="w-4 h-4 text-foreground/40" />
            <span className="sr-only">Filter flags</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by key"
              className="flex-1 bg-transparent text-sm focus:outline-none"
            />
          </label>
        </div>
      </section>

      <section className="px-4">
        <div className="container mx-auto max-w-5xl">
          {loadError ? (
            <ListError message={loadError} onRetry={() => void load()} />
          ) : flags === null ? (
            <ListSkeleton count={4} rowHeight={96} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Flag}
              title={flags.length === 0 ? 'No feature flags defined' : 'No flags match your filter'}
              description={
                flags.length === 0
                  ? 'Flags appear here once they are created through the API.'
                  : undefined
              }
            />
          ) : (
            <ul className="space-y-3">
              {visible.map((flag) => (
                <FlagRow
                  key={flag.key}
                  flag={flag}
                  busy={submittingKey === flag.key}
                  status={rowStatus[flag.key] ?? null}
                  historyVersion={historyVersion[flag.key] ?? 0}
                  onChange={requestChange}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {pending && (
        <SensitiveConfirmDialog
          flagKey={pending.flag.key}
          changeLabel={pending.label}
          submitting={submittingKey === pending.flag.key}
          onCancel={() => setPending(null)}
          onConfirm={() => void apply(pending.flag, pending.change, pending.label, true)}
        />
      )}
    </div>
  );
}

function FlagRow({
  flag,
  busy,
  status,
  historyVersion,
  onChange,
}: {
  flag: FeatureFlag;
  busy: boolean;
  status: RowStatus;
  historyVersion: number;
  onChange: (flag: FeatureFlag, change: FlagChange, label: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [draftPct, setDraftPct] = useState<string>(
    flag.rolloutPercentage === null ? '' : String(flag.rolloutPercentage),
  );

  // Keep the draft in sync when the saved flag changes (after a save/refresh).
  useEffect(() => {
    setDraftPct(flag.rolloutPercentage === null ? '' : String(flag.rolloutPercentage));
  }, [flag.rolloutPercentage]);

  const parsedPct = draftPct.trim() === '' ? null : Number(draftPct);
  const pctValid =
    parsedPct === null || (Number.isInteger(parsedPct) && parsedPct >= 0 && parsedPct <= 100);
  const pctDirty = parsedPct !== flag.rolloutPercentage;
  const hasRollout = flag.rolloutPercentage !== null;
  const lastChanged = new Date(flag.updatedAt);

  return (
    <li
      className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden"
      aria-label={`Feature flag ${flag.key}`}
    >
      <div className="p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-sm font-semibold break-all">{flag.key}</code>
              <span
                className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-full',
                  flag.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-foreground/50',
                )}
              >
                {flag.enabled ? 'ON' : 'OFF'}
              </span>
              {flag.sensitive && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                  <ShieldAlert className="w-3 h-3" /> SENSITIVE
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-foreground/70" data-testid="targeting-rule">
              {describeTargeting(flag)}
            </p>
            <p className="mt-1 text-xs text-foreground/40" data-testid="last-change">
              Last changed{' '}
              <time dateTime={flag.updatedAt}>
                {Number.isNaN(lastChanged.getTime()) ? 'unknown' : lastChanged.toLocaleString()}
              </time>
              {flag.changedBy ? ` by ${flag.changedBy}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-foreground/50" aria-hidden="true">
              Enabled
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={flag.enabled}
              aria-label={`Toggle ${flag.key}`}
              disabled={busy}
              onClick={() =>
                onChange(
                  flag,
                  { enabled: !flag.enabled },
                  `Turn ${flag.key} ${flag.enabled ? 'off' : 'on'}`,
                )
              }
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors disabled:opacity-50',
                flag.enabled ? 'bg-emerald-500/70' : 'bg-white/15',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                  flag.enabled && 'translate-x-5',
                )}
              />
            </button>
          </div>
        </div>

        {hasRollout && (
          <p className="text-xs text-foreground/40">
            A rollout percentage is set, so it decides the result for signed-in users and the
            on/off switch only applies to anonymous callers. Clear the rollout to return to plain
            on/off.
          </p>
        )}

        <form
          className="flex flex-col sm:flex-row sm:items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pctValid || !pctDirty || busy) return;
            onChange(
              flag,
              { rolloutPercentage: parsedPct },
              parsedPct === null
                ? `Clear the rollout on ${flag.key}`
                : `Set ${flag.key} rollout to ${parsedPct}%`,
            );
          }}
        >
          <label className="flex-1 text-xs text-foreground/50">
            Rollout percentage
            <div className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={parsedPct !== null && pctValid ? parsedPct : 0}
                onChange={(e) => setDraftPct(e.target.value)}
                aria-label={`Rollout slider for ${flag.key}`}
                className="flex-1 accent-primary"
                disabled={busy}
              />
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                value={draftPct}
                placeholder="none"
                onChange={(e) => setDraftPct(e.target.value)}
                aria-label={`Rollout percentage for ${flag.key}`}
                aria-invalid={!pctValid}
                className={cn(
                  'w-20 rounded-lg border bg-white/5 px-2 py-1.5 text-sm text-foreground',
                  pctValid ? 'border-white/10' : 'border-red-500/60',
                )}
                disabled={busy}
              />
              <span className="text-foreground/40">%</span>
            </div>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!pctValid || !pctDirty || busy}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply rollout
            </button>
            {hasRollout && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onChange(flag, { rolloutPercentage: null }, `Clear the rollout on ${flag.key}`)
                }
                className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Clear rollout
              </button>
            )}
          </div>
        </form>
        {!pctValid && (
          <p className="text-xs text-red-400" role="alert">
            Enter a whole number from 0 to 100, or leave empty for no rollout.
          </p>
        )}

        {status && (
          <p
            role="status"
            className={cn(
              'rounded-lg px-3 py-2 text-xs',
              status.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400',
            )}
          >
            {status.message}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground/80"
          >
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showHistory ? 'Hide history' : 'Show history'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onChange(
                flag,
                { sensitive: !flag.sensitive },
                flag.sensitive
                  ? `Remove the sensitive marker from ${flag.key}`
                  : `Mark ${flag.key} as sensitive`,
              )
            }
            className="text-xs text-foreground/40 hover:text-amber-300 disabled:opacity-50"
          >
            {flag.sensitive ? 'Unmark sensitive' : 'Mark sensitive'}
          </button>
        </div>
        {showHistory && <FlagHistory flagKey={flag.key} refreshToken={historyVersion} />}
      </div>
    </li>
  );
}
