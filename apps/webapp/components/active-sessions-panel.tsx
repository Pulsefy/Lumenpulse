"use client";

import { useCallback, useEffect, useState } from 'react';
import { SessionApiService, type UserSession } from '@/lib/session-service';

function formatWhen(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function ActiveSessionsPanel() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSessions(await SessionApiService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (session: UserSession) => {
    setBusyId(session.id);
    try {
      await SessionApiService.revoke(session.id);
      // Revoking the session we are on signs this browser out immediately.
      if (session.isCurrent) {
        window.location.assign('/auth/login');
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Sign out of every device, including this one?')) return;
    setBusyId('all');
    try {
      await SessionApiService.revokeAll();
      window.location.assign('/auth/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions');
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading sessions...</p>;

  return (
    <section aria-label="Active sessions" className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {sessions.length === 0 ? (
        <p className="text-sm text-gray-400">No active sessions.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1 text-sm">
                <p className="font-medium text-white">
                  {session.deviceInfo || 'Unknown device'}
                  {session.isCurrent && (
                    <span className="ml-2 rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-gray-400">
                  {session.locationHint || 'Unknown location'}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                </p>
                <p className="text-gray-500">Last seen {formatWhen(session.lastSeenAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(session)}
                disabled={busyId !== null}
                className="rounded-md border border-red-400/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-50"
              >
                {session.isCurrent ? 'Sign out' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > 1 && (
        <button
          type="button"
          onClick={() => void revokeAll()}
          disabled={busyId !== null}
          className="rounded-md bg-red-500/80 px-4 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-50"
        >
          Sign out everywhere
        </button>
      )}
    </section>
  );
}
