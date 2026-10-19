"use client";

import ActiveSessionsPanel from '@/components/active-sessions-panel';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function SessionsPage() {
  const { loading, isAuthenticated } = useAuthGuard();

  return (
    <main className="min-h-screen px-4 py-24 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold text-white mb-2">Active Sessions</h1>
        <p className="text-sm text-gray-400 mb-6">
          Devices currently signed in to your account. Revoking a session signs that device out
          immediately.
        </p>
        {loading || !isAuthenticated ? <ListSkeleton count={3} /> : <ActiveSessionsPanel />}
      </div>
    </main>
  );
}
