import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EnvironmentBanner } from "./environment-banner";

describe("EnvironmentBanner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing when no label is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_ENV_LABEL", "");
    const { container } = render(<EnvironmentBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the configured label", () => {
    vi.stubEnv("NEXT_PUBLIC_ENV_LABEL", "Preview - PR #42");
    render(<EnvironmentBanner />);
    expect(screen.getByTestId("environment-banner")).toHaveTextContent("Preview - PR #42");
  });
});
