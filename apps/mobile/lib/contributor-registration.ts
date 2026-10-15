import type { ApiError, ApiResponse } from './api-client';
import type {
  RegisterContributorRequest,
  RegistrationNonce,
  RegistrationSubmission,
} from './contributor';

/**
 * Mirrors the backend `GITHUB_HANDLE_PATTERN` in
 * `apps/backend/src/contributor-registry/dto/contributor-registry.dto.ts`.
 * Validating locally avoids a round-trip for an obviously bad handle.
 */
export const GITHUB_HANDLE_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/** Progress markers emitted while a registration attempt runs. */
export type RegistrationStage =
  | 'idle'
  | 'fetching_nonce'
  | 'awaiting_signature'
  | 'revalidating_nonce'
  | 'submitting'
  | 'verifying'
  | 'success'
  | 'failed';

export type RegistrationFailureCode =
  | 'missing_address'
  | 'invalid_handle'
  | 'nonce_unavailable'
  | 'nonce_expired'
  | 'signature_rejected'
  | 'signature_failed'
  | 'already_registered'
  | 'handle_taken'
  | 'unauthorized'
  | 'unconfirmed'
  | 'network'
  | 'unknown';

/**
 * A registration failure, already shaped for display. `retryable` tells the UI
 * whether offering "Try again" is honest — a taken GitHub handle, for example,
 * will never succeed no matter how many times it is retried.
 */
export interface RegistrationFailure {
  code: RegistrationFailureCode;
  title: string;
  message: string;
  retryable: boolean;
}

/** The tuple a registration signature is bound to. */
export interface RegistrationIntent {
  address: string;
  githubHandle: string;
  nonce: number;
}

export interface RegistrationSignatureRequest extends RegistrationIntent {
  /** Canonical string the wallet is asked to authorize. */
  message: string;
}

/**
 * Outcome of the wallet signing step.
 *
 * `signedAuthEntryXdr` is the off-chain `SorobanAuthorizationEntry` the gasless
 * relayer attaches to the transaction. `transactionHash` is set when the wallet
 * broadcast the registration itself (SEP-0007 `tx`), in which case there is
 * nothing left to submit and the registration is confirmed instead.
 */
export type RegistrationSignatureResult =
  | {
      status: 'success';
      signedAuthEntryXdr?: string;
      transactionHash?: string;
      signatureHex?: string;
    }
  | { status: 'rejected'; message?: string }
  | { status: 'failed'; message?: string };

/**
 * Collaborators injected by the screen so the flow can be unit tested without
 * a wallet, a network, or a device.
 */
export interface RegistrationDeps {
  getNonce(address: string): Promise<ApiResponse<RegistrationNonce>>;
  requestSignature(request: RegistrationSignatureRequest): Promise<RegistrationSignatureResult>;
  submitRegistration(
    payload: RegisterContributorRequest,
  ): Promise<ApiResponse<RegistrationSubmission>>;
  /** Confirms a registration the wallet broadcast on its own. */
  verifyRegistration?(address: string): Promise<boolean>;
}

export type RegistrationResult =
  | { status: 'success'; submission: RegistrationSubmission }
  | { status: 'failure'; failure: RegistrationFailure };

export interface RunContributorRegistrationArgs {
  address: string | null;
  githubHandle: string;
  deps: RegistrationDeps;
  onStage?: (stage: RegistrationStage) => void;
}

/** Strip a leading `@` and surrounding whitespace from a GitHub handle. */
export function normalizeGithubHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

export function isValidGithubHandle(handle: string): boolean {
  return GITHUB_HANDLE_PATTERN.test(handle);
}

/**
 * The message a contributor authorizes. It binds the function name, the handle
 * being registered, the wallet address and the current nonce — the same tuple
 * the contract puts in the `require_auth_for_args` scope — so a signature
 * cannot be replayed for another handle, wallet or nonce.
 */
export function buildRegistrationMessage(request: RegistrationIntent): string {
  return [
    'Lumenpulse contributor registration',
    `contract: contributor-registry`,
    `method: register_contributor_with_sig`,
    `address: ${request.address}`,
    `github_handle: ${request.githubHandle}`,
    `nonce: ${request.nonce}`,
  ].join('\n');
}

/** Build the display shape for a failure code, optionally adding server detail. */
export function createRegistrationFailure(
  code: RegistrationFailureCode,
  detail?: string,
): RegistrationFailure {
  const withDetail = (fallback: string) => (detail?.trim() ? detail.trim() : fallback);

  switch (code) {
    case 'missing_address':
      return {
        code,
        title: 'No wallet connected',
        message: 'Connect a Stellar wallet before registering a contributor identity.',
        retryable: false,
      };
    case 'invalid_handle':
      return {
        code,
        title: 'Invalid GitHub handle',
        message:
          'GitHub handles are 1-39 letters, numbers or hyphens, and cannot start or end with a hyphen.',
        retryable: false,
      };
    case 'nonce_unavailable':
      return {
        code,
        title: 'Could not reach the registry',
        message: withDetail(
          'We could not fetch your registration code. Check your connection and try again.',
        ),
        retryable: true,
      };
    case 'nonce_expired':
      return {
        code,
        title: 'Registration code expired',
        message: withDetail(
          'Your registration code changed while you were signing, so the signature is no longer valid. Nothing was submitted — tap Register again to start from a fresh code.',
        ),
        retryable: true,
      };
    case 'signature_rejected':
      return {
        code,
        title: 'Signature declined',
        message: withDetail(
          'You declined the signature request in your wallet, so nothing was submitted. Tap Register to try again.',
        ),
        retryable: true,
      };
    case 'signature_failed':
      return {
        code,
        title: 'Wallet could not sign',
        message: withDetail(
          'Your wallet did not return a signature. Make sure the wallet app is installed and unlocked, then try again.',
        ),
        retryable: true,
      };
    case 'already_registered':
      return {
        code,
        title: 'Already registered',
        message: withDetail(
          'This wallet already has an on-chain contributor record. Pull to refresh to see it.',
        ),
        retryable: false,
      };
    case 'handle_taken':
      return {
        code,
        title: 'GitHub handle already linked',
        message: withDetail(
          'That GitHub handle is already bound to another contributor. Choose a different handle.',
        ),
        retryable: false,
      };
    case 'unauthorized':
      return {
        code,
        title: 'Registration not permitted',
        message: withDetail(
          'The registry rejected this registration because this account is not authorized to submit it. An ecosystem verifier can complete it on your behalf.',
        ),
        retryable: false,
      };
    case 'unconfirmed':
      return {
        code,
        title: 'Registration not confirmed',
        message: withDetail(
          'Your wallet reported the transaction, but the registry has no record for this wallet yet. It may still be settling — pull to refresh in a moment.',
        ),
        retryable: true,
      };
    case 'network':
      return {
        code,
        title: 'Connection problem',
        message: withDetail(
          'We could not reach the contributor registry. Check your connection and try again.',
        ),
        retryable: true,
      };
    case 'unknown':
    default:
      return {
        code: 'unknown',
        title: 'Registration failed',
        message: withDetail('Something went wrong while registering. Please try again.'),
        retryable: true,
      };
  }
}

/**
 * Turn a submission error into a distinct, actionable failure.
 *
 * The registry returns `409` both for an already-registered wallet and for a
 * taken handle, so the messages are inspected to keep the two apart; anything
 * mentioning a nonce is reported as an expired code rather than a generic 400.
 */
export function classifySubmissionError(error?: ApiError): RegistrationFailure {
  const message = (error?.message ?? '').toLowerCase();
  const status = error?.statusCode;

  if (message.includes('nonce')) {
    return createRegistrationFailure('nonce_expired', error?.message);
  }

  if (status === 409) {
    if (message.includes('handle') && (message.includes('taken') || message.includes('already'))) {
      return createRegistrationFailure('handle_taken', error?.message);
    }
    return createRegistrationFailure('already_registered', error?.message);
  }

  if (status === 401 || status === 403) {
    return createRegistrationFailure('unauthorized', error?.message);
  }

  if (status === 400) {
    if (message.includes('handle')) {
      return createRegistrationFailure('invalid_handle', error?.message);
    }
    if (message.includes('signature') || message.includes('xdr')) {
      return createRegistrationFailure('signature_failed', error?.message);
    }
    return createRegistrationFailure('unknown', error?.message);
  }

  if (status === undefined) {
    return createRegistrationFailure('network', error?.message);
  }

  return createRegistrationFailure('unknown', error?.message);
}

/**
 * Drive the gasless contributor registration flow:
 *
 * 1. read the current registration nonce,
 * 2. ask the wallet to authorize that nonce,
 * 3. re-read the nonce to detect a stale signature before submitting,
 * 4. submit the signature (or confirm a wallet-broadcast transaction).
 *
 * Every exit is a typed result, so the caller never has to inspect raw errors
 * to decide what to show the contributor.
 */
export async function runContributorRegistration({
  address,
  githubHandle,
  deps,
  onStage,
}: RunContributorRegistrationArgs): Promise<RegistrationResult> {
  const handle = normalizeGithubHandle(githubHandle);

  if (!address) {
    return fail(onStage, createRegistrationFailure('missing_address'));
  }

  if (!isValidGithubHandle(handle)) {
    return fail(onStage, createRegistrationFailure('invalid_handle'));
  }

  try {
    onStage?.('fetching_nonce');
    const nonceRes = await deps.getNonce(address);
    if (!nonceRes.success || !nonceRes.data) {
      return fail(onStage, createRegistrationFailure('nonce_unavailable', nonceRes.error?.message));
    }
    const nonce = nonceRes.data.nonce;

    onStage?.('awaiting_signature');
    const signature = await deps.requestSignature({
      address,
      githubHandle: handle,
      nonce,
      message: buildRegistrationMessage({ address, githubHandle: handle, nonce }),
    });

    if (signature.status === 'rejected') {
      return fail(onStage, createRegistrationFailure('signature_rejected', signature.message));
    }
    if (signature.status === 'failed') {
      return fail(onStage, createRegistrationFailure('signature_failed', signature.message));
    }

    // The contract advances its per-address nonce after every signed attempt, so
    // a nonce that moved while the user was in their wallet means the signature
    // is already stale. Catching it here gives a precise message instead of a
    // generic submission failure.
    onStage?.('revalidating_nonce');
    const freshNonceRes = await deps.getNonce(address);
    if (!freshNonceRes.success || !freshNonceRes.data) {
      return fail(
        onStage,
        createRegistrationFailure('nonce_unavailable', freshNonceRes.error?.message),
      );
    }
    if (freshNonceRes.data.nonce !== nonce) {
      return fail(onStage, createRegistrationFailure('nonce_expired'));
    }

    if (signature.signedAuthEntryXdr) {
      onStage?.('submitting');
      const submitRes = await deps.submitRegistration({
        address,
        githubHandle: handle,
        signedAuthEntryXdr: signature.signedAuthEntryXdr,
        signatureHex: signature.signatureHex,
      });

      if (submitRes.success && submitRes.data) {
        onStage?.('success');
        return { status: 'success', submission: submitRes.data };
      }

      return fail(onStage, classifySubmissionError(submitRes.error));
    }

    // The wallet broadcast the registration itself (SEP-0007 `tx`), so there is
    // no auth entry to relay: confirm the registry instead of assuming success.
    onStage?.('verifying');
    const confirmed = deps.verifyRegistration ? await deps.verifyRegistration(address) : false;
    if (!confirmed) {
      return fail(onStage, createRegistrationFailure('unconfirmed'));
    }

    onStage?.('success');
    return {
      status: 'success',
      submission: {
        transactionHash: signature.transactionHash ?? '',
        status: 'SUCCESS',
      },
    };
  } catch (error) {
    return fail(
      onStage,
      createRegistrationFailure('unknown', error instanceof Error ? error.message : undefined),
    );
  }
}

function fail(onStage: RunContributorRegistrationArgs['onStage'], failure: RegistrationFailure) {
  onStage?.('failed');
  return { status: 'failure', failure } as const;
}
