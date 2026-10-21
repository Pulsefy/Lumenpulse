"use client";

import SavedSearchesPanel from '@/components/saved-searches-panel';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function SavedSearchesPage() {
  const { loading, isAuthenticated } = useAuthGuard();

  return (
    <main className="min-h-screen px-4 py-24 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold text-white mb-2">Saved Searches</h1>
        <p className="text-sm text-gray-400 mb-6">
          Re-run the searches you keep coming back to, and get notified when new results appear.
        </p>
        {loading || !isAuthenticated ? <ListSkeleton count={3} /> : <SavedSearchesPanel />}
      </div>
    </main>
  );
}
