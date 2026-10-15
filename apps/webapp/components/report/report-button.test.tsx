import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportButton } from "./report-button";

describe("ReportButton + ReportDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = () =>
    render(
      <ReportButton targetType="project" targetId="42" targetLabel="Project #42" />
    );

  it("does not show the dialog until the trigger is clicked", () => {
    setup();
    expect(screen.queryByText(/report project #42/i)).not.toBeInTheDocument();
  });

  it("opens the dialog with category options when the trigger is clicked", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /report project #42/i }));

    expect(screen.getByText(/report project #42/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit report" })).toBeDisabled();
  });

  it("requires a category before the submit button is enabled", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /report project #42/i }));
    await userEvent.click(screen.getByRole("button", { name: "Fraud or scam" }));

    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
  });

  it("shows a success state after a successful submission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: "1", status: "pending" }),
      })
    );

    setup();
    await userEvent.click(screen.getByRole("button", { name: /report project #42/i }));
    await userEvent.click(screen.getByRole("button", { name: "Spam" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(screen.getByText(/report submitted/i)).toBeInTheDocument());
  });

  it("shows an inline error message when submission fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: "You have already reported this content." }),
      })
    );

    setup();
    await userEvent.click(screen.getByRole("button", { name: /report project #42/i }));
    await userEvent.click(screen.getByRole("button", { name: "Spam" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit report" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already reported/i)
    );
    // The form should stay open and usable so the person can retry.
    expect(screen.getByRole("button", { name: "Submit report" })).toBeInTheDocument();
  });
});
