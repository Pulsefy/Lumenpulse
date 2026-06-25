/**
 * useGaslessIntent.ts
 *
 * React hook that orchestrates:
 *   1. Fetching the user's current nonce from the backend.
 *   2. Building + signing the SorobanAuthorizationEntry via Freighter.
 *   3. Posting the signed intent to POST /relayer/intent.
 *
 * Usage:
 *   const { submit, loading, txHash, error } = useGaslessIntent();
 *   await submit({
 *     intentType: 'register_contributor',
 *     payload: 'my-github-handle',
 *     contractId: process.env.NEXT_PUBLIC_CONTRIBUTOR_REGISTRY_CONTRACT_ID!,
 *   });
 */

'use client';

import { useState, useCallback } from 'react';
import { buildAndSignGaslessIntent, type IntentType } from '../lib/gasless-intent';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_API_URL ?? 'http://localhost:3001';

export interface UseGaslessIntentSubmitParams {
  intentType: IntentType;
  /** GitHub handle or JSON-serialised ProjectMetadata. */
  payload: string;
  contractId: string;
}

export interface UseGaslessIntentResult {
  submit: (params: UseGaslessIntentSubmitParams) => Promise<void>;
  loading: boolean;
  txHash: string | null;
  error: string | null;
  reset: () => void;
}

export function useGaslessIntent(): UseGaslessIntentResult {
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTxHash(null);
    setError(null);
  }, []);

  const submit = useCallback(
    async ({ intentType, payload, contractId }: UseGaslessIntentSubmitParams) => {
      setLoading(true);
      setTxHash(null);
      setError(null);

      try {
        // 1. Get the connected wallet's public key.
        if (!window.freighter) {
          throw new Error('Freighter wallet extension is not installed');
        }
        const userPublicKey = await window.freighter.getPublicKey();

        // 2. Fetch the current nonce so the auth-entry scope is correct.
        let nonce = 0;
        if (intentType === 'register_contributor') {
          const nonceRes = await fetch(
            `${BACKEND_URL}/relayer/nonce?publicKey=${encodeURIComponent(userPublicKey)}&contractId=${encodeURIComponent(contractId)}`,
          );
          if (nonceRes.ok) {
            const data = (await nonceRes.json()) as { nonce: number };
            nonce = data.nonce;
          }
        }

        // 3. Build & sign the auth entry off-chain via Freighter.
        const signedIntent = await buildAndSignGaslessIntent({
          intentType,
          userPublicKey,
          payload,
          contractId,
          nonce,
        });

        // 4. POST to the backend relayer.
        const relayRes = await fetch(`${BACKEND_URL}/relayer/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signedIntent),
        });

        if (!relayRes.ok) {
          const body = (await relayRes.json()) as { message?: string };
          throw new Error(body.message ?? `Relayer returned ${relayRes.status}`);
        }

        const result = (await relayRes.json()) as { txHash: string; status: string };
        setTxHash(result.txHash);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { submit, loading, txHash, error, reset };
}
