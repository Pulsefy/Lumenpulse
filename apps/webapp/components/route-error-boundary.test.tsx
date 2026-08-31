import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteErrorBoundary } from "./route-error-boundary";

const defaultProps = {
  error: new Error("Test crash message"),
  reset: vi.fn(),
  segment: "dashboard",
};

function ThrowingComponent() {
  throw new Error("Component threw!");
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the global error reporting seam
    // @ts-expect-error — testing the seam
    window.__lumenpulse_reportError = undefined;
  });

  it("renders a recoverable error message instead of crashing", () => {
    render(
      <RouteErrorBoundary
        error={defaultProps.error}
        reset={defaultProps.reset}
        segment="dashboard"
      />
    );

    expect(
      screen.getByRole("heading", { name: /something went wrong/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/unexpected error occurred/i)).toBeInTheDocument();
  });

  it("displays the error message", () => {
    render(<RouteErrorBoundary {...defaultProps} />);
    expect(screen.getByText("Test crash message")).toBeInTheDocument();
  });

  it("does not render a stack trace", () => {
    render(<RouteErrorBoundary {...defaultProps} />);
    expect(screen.queryByText(/at \w+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.tsx/)).not.toBeInTheDocument();
  });

  it("calls reset when Try again is clicked", async () => {
    const reset = vi.fn();
    render(<RouteErrorBoundary {...defaultProps} reset={reset} />);

    await userEvent.click(
      screen.getByRole("button", { name: /try again/i })
    );
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders a home link", () => {
    render(<RouteErrorBoundary {...defaultProps} />);
    expect(
      screen.getByRole("link", { name: /go home/i })
    ).toHaveAttribute("href", "/");
  });

  it("has role=alert for accessibility", () => {
    render(<RouteErrorBoundary {...defaultProps} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("forwards the segment to the error-reporting seam", () => {
    const reportError = vi.fn();
    // @ts-expect-error — testing the seam
    window.__lumenpulse_reportError = reportError;

    render(<RouteErrorBoundary {...defaultProps} segment="grants" />);

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ segment: "grants" })
    );
  });

  it("renders without crashing even when segment-specific errors are thrown", () => {
    // Simulate what Next.js does: render the error boundary in place of the crashed subtree
    const error = new Error("Grant detail threw!");
    const { container } = render(
      <RouteErrorBoundary error={error} reset={vi.fn()} segment="grants" />
    );

    expect(container.textContent).not.toBe("");
    expect(screen.getByText("Grant detail threw!")).toBeInTheDocument();
    // The crashed subtree's content is not rendered
    expect(container.querySelector("h1")).toHaveTextContent(
      "Something went wrong"
    );
  });
});
