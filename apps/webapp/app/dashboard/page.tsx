"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StellarBalancesPanel from "@/components/stellar-balances-panel";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard");
      return;
    }

    // TODO: replace this with real user wallet later
    // For now, we simulate "no wallet connected"
    setPublicKey(null);

    setIsLoading(false);
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <p className="text-lg mb-4">Welcome to your personal dashboard.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">

        {/* Stellar Panel */}
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
          <StellarBalancesPanel publicKey={publicKey} />
        </div>

        {/* Other cards */}
        <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Portfolio Overview</h2>
          <p className="text-gray-400">
            Your portfolio statistics will appear here.
          </p>
        </div>

        <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
          <p className="text-gray-400">
            Your transactions will appear here.
          </p>
        </div>

        <div className="bg-gray-900 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Market Insights</h2>
          <p className="text-gray-400">
            Insights will appear here.
          </p>
        </div>

      </div>
    </div>
  );
}