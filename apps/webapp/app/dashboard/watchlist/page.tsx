"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import WatchlistPanel from "@/components/watchlist-panel";
import AssetDetail from "@/components/asset-detail";
import { WatchlistProvider } from "@/hooks/use-watchlist";

export default function WatchlistPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<{
    code: string;
    issuer?: string;
    balance: string;
  } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const authToken = document.cookie.includes("auth-token");
    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard/watchlist");
      return;
    }
    setIsLoading(false);
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <WatchlistProvider>
      <div className="min-h-screen bg-black text-white p-8">
        {selectedAsset ? (
          <AssetDetail
            code={selectedAsset.code}
            issuer={selectedAsset.issuer}
            balance={selectedAsset.balance}
            onBack={() => setSelectedAsset(null)}
          />
        ) : (
          <>
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={() => router.push("/dashboard")}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
              >
                <ArrowLeft size={20} />
                Back to Dashboard
              </button>
            </div>

            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-yellow-500/10 rounded-xl">
                <Star
                  size={28}
                  className="text-yellow-400 fill-yellow-400"
                />
              </div>
              <div>
                <h1 className="text-3xl font-bold">My Watchlist</h1>
                <p className="text-gray-400 mt-1">
                  Track your bookmarked assets and projects
                </p>
              </div>
            </div>

            <WatchlistPanel
              onSelectAsset={(asset) =>
                setSelectedAsset({
                  code: asset.code,
                  issuer: asset.issuer,
                  balance: "0",
                })
              }
            />
          </>
        )}
      </div>
    </WatchlistProvider>
  );
}
