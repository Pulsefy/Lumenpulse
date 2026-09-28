/**
 * Claim envelope requests for the vesting / treasury claim screen (issue #1409).
 *
 * The mobile app does not bundle a Soroban client: hand-building a contract
 * invocation envelope on device would duplicate the RPC simulation and
 * resource-footprint assembly the backend already performs
 * (`apps/backend/src/vesting-wallet/vesting-wallet-soroban.client.ts`).
 *
 * So the app asks the API for an *unsigned* envelope whose source account is
 * the beneficiary, then hands it to the wallet adapter to sign. This module is
 * the thin, testable seam between the screen and that request.
 */

import { apiClient } from './api-client';
import type { ClaimSource } from './vesting';

export interface ClaimEnvelopeResponse {
  /** Base64 transaction envelope, unsigned. */
  xdr: string;
  /** Passphrase the wallet must sign against. */
  networkPassphrase: string;
}

/**
 * Endpoint that returns the unsigned claim envelope for a source.
 * `POST /vesting-wallet/vesting/:beneficiary/claim-envelope` and
 * `POST /treasury/streams/:beneficiary/claim-envelope`.
 */
export function claimEnvelopePath(source: ClaimSource, beneficiary: string): string {
  const encoded = encodeURIComponent(beneficiary);
  return source === 'treasury'
    ? `/treasury/streams/${encoded}/claim-envelope`
    : `/vesting-wallet/vesting/${encoded}/claim-envelope`;
}

/**
 * Fetches the unsigned claim envelope. Throws with the API's message so the
 * claim orchestrator can put it on the failure receipt.
 */
export async function requestClaimEnvelope(request: {
  source: ClaimSource;
  beneficiary: string;
  contractId: string;
}): Promise<string> {
  const response = await apiClient.post<ClaimEnvelopeResponse>(
    claimEnvelopePath(request.source, request.beneficiary),
    { contractId: request.contractId },
  );

  if (!response.success || !response.data?.xdr) {
    throw new Error(response.error?.message ?? 'Could not build the claim transaction.');
  }

  return response.data.xdr;
}
