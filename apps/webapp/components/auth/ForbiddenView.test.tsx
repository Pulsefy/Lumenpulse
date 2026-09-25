import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenView } from "./ForbiddenView";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => {
    const { default: _, ...rest } = props as Record<string, unknown>;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

describe("ForbiddenView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 403-style forbidden view with default title and description", () => {
    render(<ForbiddenView />);

    expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument();
    expect(
      screen.getByText(/you do not have permission to access this area/i),
    ).toBeInTheDocument();
  });

  it("renders custom title and description when provided", () => {
    render(
      <ForbiddenView
        title="Admin Access Required"
        description="Your account does not have permission to access the admin console."
      />,
    );

    expect(
      screen.getByRole("heading", { name: /admin access required/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/your account does not have permission/i),
    ).toBeInTheDocument();
  });

  it("renders a home link pointing to /", () => {
    render(<ForbiddenView />);

    const homeLink = screen.getByRole("link", { name: /return to home/i });
    expect(homeLink).toHaveAttribute("href", "/");
  });

  it("renders a go-back link with custom backHref by default", () => {
    render(<ForbiddenView backHref="/dashboard" />);

    const backLink = screen.getByRole("link", { name: /go back/i });
    expect(backLink).toHaveAttribute("href", "/dashboard");
  });

  it("hides the back link when showBackLink=false", () => {
    render(<ForbiddenView showBackLink={false} />);

    expect(screen.queryByRole("link", { name: /go back/i })).not.toBeInTheDocument();
    // Home link is still present
    expect(screen.getByRole("link", { name: /return to home/i })).toBeInTheDocument();
  });

  it("renders a shield icon (aria-hidden) for the visual", () => {
    const { container } = render(<ForbiddenView />);
    // lucide-react renders SVG directly, use a class / presence check
    const svg = container.querySelector("svg.lucide-shield");
    expect(svg).toBeInTheDocument();
  });
});
