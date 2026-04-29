import { render, screen } from "@testing-library/react";
import { TransactionFeed } from "./TransactionFeed";

describe("TransactionFeed", () => {
  it("renders loading state", () => {
    render(<TransactionFeed publicKey="test" />);
    expect(screen.getByText(/Loading transactions/i)).toBeInTheDocument();
  });
});