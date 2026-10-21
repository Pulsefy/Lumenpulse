'use client';

import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import {
  FeatureFlagsApiService,
  describeAuditEntry,
  type FlagAuditEntry,
} from '@/lib/feature-flags-service';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { ListError } from '@/components/ui/list-error';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  flagKey: string;
  /** Bumped by the parent after each successful change to force a reload. */
  refreshToken: number;
}

/** Per-flag change history: actor, timestamp and what changed, newest first. */
export default function FlagHistory({ flagKey, refreshToken }: Props) {
  const [entries, setEntries] = useState<FlagAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setEntries(null);
    try {
      setEntries(await FeatureFlagsApiService.getHistory(flagKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    }
  }, [flagKey]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (error) return <ListError message={error} onRetry={load} className="py-6" />;
  if (entries === null) return <ListSkeleton count={2} rowHeight={48} />;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No recorded changes"
        description="This flag has not been changed since auditing began."
        className="py-6"
      />
    );
  }

  return (
    <ol className="space-y-1.5" aria-label={`Change history for ${flagKey}`}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
        >
          <span className="text-foreground/80">{describeAuditEntry(entry)}</span>
          <span className="text-foreground/40">
            <span className="text-foreground/60">{entry.actor ?? 'unknown actor'}</span>
            {' · '}
            <time dateTime={entry.changedAt}>
              {new Date(entry.changedAt).toLocaleString()}
            </time>
          </span>
        </li>
      ))}
    </ol>
  );
}
