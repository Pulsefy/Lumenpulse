/**
 * gasless-intent.ts
 *
 * Utilities for building and signing a SorobanAuthorizationEntry off-chain
 * via Freighter, then submitting it through the backend relayer so the user
 * never needs to hold XLM for fees.
 *
 * Flow:
 *   1. Build a minimal `SorobanAuthorizationEntry` for the desired intent.
 *   2. Call Freighter `signAuthEntry` — user signs with their private key
 *      without broadcasting a transaction.
 *   3. POST the signed XDR + metadata to `POST /relayer/intent`.
 *   4. The relayer builds, signs, and submits the full transaction.
 */

import {
  xdr,
  Address,
  nativeToScVal,
  hash,
  Networks,
} from '@stellar/stellar-sdk';

// Freighter's web-extension API
declare global {
  interface Window {
    freighter?: {
      signAuthEntry: (
        authEntryXdr: string,
        opts?: { networkPassphrase?: string },
      ) => Promise<{ signedAuthEntry: string; signerAddress: string }>;
      getPublicKey: () => Promise<string>;
      isConnected: () => Promise<boolean>;
    };
  }
}

export type IntentType = 'register_contributor' | 'propose_project';

export interface GaslessIntentParams {
  intentType: IntentType;
  /** User's Stellar G-address (fetched from Freighter). */
  userPublicKey: string;
  /** For register_contributor: GitHub handle. For propose_project: JSON ProjectMetadata string. */
  payload: string;
  /**
   * Contract ID to authorize against.
   * - register_contributor → CONTRIBUTOR_REGISTRY_CONTRACT_ID
   * - propose_project      → CURATION_CONTRACT_ID
   */
  contractId: string;
  /** Current per-address nonce from `get_registration_nonce` query (for register_contributor). */
  nonce?: number;
  networkPassphrase?: string;
}

export interface SignedIntent {
  intentType: IntentType;
  signedAuthEntryXdr: string;
  userPublicKey: string;
  payload: string;
}

/**
 * Build a `SorobanAuthorizationEntry`, sign it with Freighter (off-chain),
 * and return the base64 XDR ready to POST to the relayer.
 */
export async function buildAndSignGaslessIntent(
  params: GaslessIntentParams,
): Promise<SignedIntent> {
  const {
    intentType,
    userPublicKey,
    payload,
    contractId,
    nonce = 0,
    networkPassphrase = Networks.TESTNET,
  } = params;

  if (!window.freighter) {
    throw new Error('Freighter wallet extension is not installed');
  }

  const connected = await window.freighter.isConnected();
  if (!connected) {
    throw new Error('Freighter is not connected. Please unlock your wallet.');
  }

  // Build the invocation args that match register_contributor_with_sig's
  // `require_auth_for_args` scope:
  //   (Symbol("register_contributor_with_sig"), github_handle, address, nonce)
  const invocationArgs = buildInvocationArgs(
    intentType,
    userPublicKey,
    payload,
    nonce,
  );

  // Construct the auth entry for the user's address.
  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(userPublicKey).toScAddress(),
        nonce: BigInt(nonce),
        signatureExpirationLedger: 0, // filled by Freighter
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(contractId).toScAddress(),
            functionName: getFunctionName(intentType),
            args: invocationArgs,
          }),
        ),
      subInvocations: [],
    }),
  });

  const authEntryXdr = authEntry.toXDR('base64');

  // Ask Freighter to sign the auth entry (not a full transaction).
  const { signedAuthEntry } = await window.freighter.signAuthEntry(authEntryXdr, {
    networkPassphrase,
  });

  return {
    intentType,
    signedAuthEntryXdr: signedAuthEntry,
    userPublicKey,
    payload,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFunctionName(intentType: IntentType): string {
  switch (intentType) {
    case 'register_contributor':
      return 'register_contributor_with_sig';
    case 'propose_project':
      return 'propose_project';
  }
}

function buildInvocationArgs(
  intentType: IntentType,
  userPublicKey: string,
  payload: string,
  nonce: number,
): xdr.ScVal[] {
  switch (intentType) {
    case 'register_contributor':
      // Matches require_auth_for_args scope:
      // (fn_name_symbol, github_handle, address, nonce)
      return [
        nativeToScVal('register_contributor_with_sig', { type: 'symbol' }),
        nativeToScVal(payload, { type: 'string' }),
        new Address(userPublicKey).toScVal(),
        nativeToScVal(nonce, { type: 'u64' }),
      ];

    case 'propose_project':
      // propose_project(proposer, metadata) — proposer auth is the scope
      return [new Address(userPublicKey).toScVal()];
  }
}
