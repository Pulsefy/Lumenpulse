export interface ContributionApiError {
  message: string;
  statusCode?: number;
  error?: string;
  details?: unknown;
}

export const CONTRIBUTIONS_PAUSED_MESSAGE =
  'Contributions are temporarily paused. Please try again after the operator resumes them.';

const CONTRIBUTION_SCOPE_PAUSED_ERROR = 19;
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Normalize both structured backend errors and raw Soroban diagnostics so the
 * contribution UI can show one deterministic pause message.
 */
export function normalizeContributionError(
  error?: ContributionApiError,
): ContributionApiError | undefined {
  if (!error) return undefined;

  const details =
    typeof error.details === 'object' && error.details !== null
      ? (error.details as Record<string, unknown>)
      : undefined;
  const detailsCode = Number(details?.contractErrorCode);
  const match = CONTRACT_ERROR_PATTERN.exec(error.message);
  const messageCode = match ? Number.parseInt(match[1], 10) : null;

  if (
    detailsCode === CONTRIBUTION_SCOPE_PAUSED_ERROR ||
    messageCode === CONTRIBUTION_SCOPE_PAUSED_ERROR
  ) {
    return {
      ...error,
      message: CONTRIBUTIONS_PAUSED_MESSAGE,
      error: 'ContributionsPausedError',
    };
  }

  return error;
}
