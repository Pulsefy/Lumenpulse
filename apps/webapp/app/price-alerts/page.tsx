"use client";

import PriceAlertsPanel from '@/components/price-alerts-panel';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { PriceAlertsProvider } from '@/hooks/use-price-alerts';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function PriceAlertsPage() {
  const { loading, isAuthenticated } = useAuthGuard();

  return (
    <main className="min-h-screen px-4 py-24 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold text-white mb-2">Price Alerts</h1>
        <p className="text-sm text-gray-400 mb-6">
          Get notified when an asset crosses a price you choose.
        </p>
        {loading || !isAuthenticated ? (
          <ListSkeleton count={3} />
        ) : (
          <PriceAlertsProvider enabled={isAuthenticated}>
            <PriceAlertsPanel />
          </PriceAlertsProvider>
        )}
      </div>
    </main>
  );
}
