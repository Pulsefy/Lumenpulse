"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TransactionList from "@/components/transaction-list";

export default function TransactionsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const authToken = document.cookie.includes("auth-token");

    if (!authToken) {
      router.push("/auth/login?callbackUrl=/transactions");
      return;
    }

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
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Transaction History</h1>
          <p className="text-gray-400">
            View all your Stellar blockchain transactions
          </p>
        </div>

        <TransactionList />
      </div>
    </div>
  );
}
