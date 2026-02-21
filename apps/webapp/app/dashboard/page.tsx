"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated (you can replace this with your auth logic)
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard");
    } else {
      setIsLoading(false);
    }
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
      <p className="text-lg mb-4">Welcome to your personal dashboard!</p>

      {/* Dashboard content goes here */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        <div className="bg-gray-900 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Portfolio Overview</h2>
          <p>Your portfolio statistics and data will appear here.</p>
        </div>

        <div className="bg-gray-900 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
          <p>Your recent blockchain transactions will appear here.</p>
        </div>

        <div className="bg-gray-900 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Market Insights</h2>
          <p>Personalized market insights will appear here.</p>
        </div>
      </div>
    </div>
  );
}

