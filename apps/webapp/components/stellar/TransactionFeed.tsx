import React, { useEffect, useState } from "react";
import { fetchRecentOperations, StellarOperation } from "../../services/stellarService";
import { TransactionItem } from "./TransactionItem";

export const TransactionFeed = ({ publicKey }: { publicKey: string }) => {
  const [txs, setTxs] = useState<StellarOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchRecentOperations(publicKey);
      setTxs(data);
    } catch (e) {
      console.error("Failed to fetch transactions", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();

    const interval = setInterval(load, 15000); // 🔄 auto refresh
    return () => clearInterval(interval);
  }, [publicKey]);

  if (loading) return <p>Loading transactions...</p>;

  return (
    <div>
      <h3>Recent Activity</h3>
      {txs.length === 0 && <p>No recent transactions</p>}
      {txs.map(tx => (
        <TransactionItem key={tx.id} tx={tx} />
      ))}
    </div>
  );
};