import { Suspense } from "react";
import AssetDetailClient from "./AssetDetailClient";

export default function AssetDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background px-4 pb-16 pt-24 text-white/60">
          Loading asset…
        </main>
      }
    >
      <AssetDetailClient />
    </Suspense>
  );
}
