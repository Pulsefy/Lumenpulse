export const CONTRIBUTIONS_PAUSED_MESSAGE =
  "Contributions are temporarily paused. Please try again after the operator resumes them.";

const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;
const CONTRIBUTION_PAUSE_CODES = new Set([
  11, // crowdfund_vault::ContractPaused
  19, // matching_pool::ContributionScopePaused
]);

/**
 * Turns raw Soroban diagnostics from the contribution path into a stable,
 * user-facing message while leaving unrelated transaction failures intact.
 */
export function getContributionErrorMessage(
  errorMessage?: string | null,
): string | null | undefined {
  if (!errorMessage) return errorMessage;

  const match = CONTRACT_ERROR_PATTERN.exec(errorMessage);
  const code = match ? Number.parseInt(match[1], 10) : null;
  return code !== null && CONTRIBUTION_PAUSE_CODES.has(code)
    ? CONTRIBUTIONS_PAUSED_MESSAGE
    : errorMessage;
}
