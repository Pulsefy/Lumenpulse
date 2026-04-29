// add import
import { TransactionFeed } from "../components/stellar/TransactionFeed";

function Dashboard() {
  const publicKey = "YOUR_STELLAR_PUBLIC_KEY";

  return (
    <div>
      {/* existing dashboard content */}

      <TransactionFeed publicKey={publicKey} />
    </div>
  );
}