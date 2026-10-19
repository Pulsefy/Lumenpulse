import { describe, expect, it } from "vitest";
import {
  CONTRIBUTIONS_PAUSED_MESSAGE,
  getContributionErrorMessage,
} from "./contribution-pause";

describe("getContributionErrorMessage", () => {
  it("maps the crowdfund vault pause diagnostic", () => {
    expect(
      getContributionErrorMessage(
        "Simulation failed: HostError: Error(Contract, #11)",
      ),
    ).toBe(CONTRIBUTIONS_PAUSED_MESSAGE);
  });

  it("maps the matching-pool contribution scope pause diagnostic", () => {
    expect(
      getContributionErrorMessage(
        "Simulation failed: HostError: Error(Contract, #19)",
      ),
    ).toBe(CONTRIBUTIONS_PAUSED_MESSAGE);
  });

  it("preserves unrelated transaction errors", () => {
    const message = "Signing failed: user rejected request";
    expect(getContributionErrorMessage(message)).toBe(message);
  });
});
