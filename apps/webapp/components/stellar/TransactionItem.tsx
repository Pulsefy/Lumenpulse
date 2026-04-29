import React from "react";
import { StellarOperation } from "../../services/stellarService";

export const TransactionItem = ({ tx }: { tx: StellarOperation }) => {
  return (
    <div style={styles.item}>
      <div>
        <strong>{tx.type}</strong>
        <div style={styles.meta}>
          {tx.from} → {tx.to}
        </div>
      </div>

      <div style={styles.right}>
        {tx.amount && (
          <div>
            {tx.amount} {tx.asset}
          </div>
        )}
        <small>{new Date(tx.created_at).toLocaleString()}</small>
      </div>
    </div>
  );
};

const styles = {
  item: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px",
    borderBottom: "1px solid #eee",
  },
  meta: {
    fontSize: "12px",
    color: "#666",
  },
  right: {
    textAlign: "right" as const,
  },
};