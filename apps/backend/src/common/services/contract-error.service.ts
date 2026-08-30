import { Injectable } from '@nestjs/common';
import {
  CONTRACT_ERROR_REGISTRY,
  ContractErrorEntry,
} from './contract-error-registry';

export interface ResolvedContractError {
  /** The raw numeric code returned by the Soroban contract. */
  code: number;
  /** Directory name of the originating contract (e.g. "crowdfund_vault"). */
  contract: string;
  /** Rust enum variant name (e.g. "ProjectNotFound"). */
  variant: string;
  /** Human-readable error message. */
  message: string;
}

/**
 * ContractErrorService resolves a raw Soroban numeric error code into a
 * human-readable message, contract name, and variant name.
 *
 * All codes follow the allocation scheme documented in
 * `document/contract-error-codes.md`. Each contract occupies a distinct
 * range of 100 codes so that any code uniquely identifies its origin.
 *
 * @example
 *   const err = contractErrorService.resolve(1404);
 *   // { code: 1404, contract: 'crowdfund_vault', variant: 'ProjectNotFound',
 *   //   message: 'Project not found' }
 */
@Injectable()
export class ContractErrorService {
  /**
   * Resolve a numeric Soroban error code to its full details.
   * Returns `null` when the code is not registered.
   */
  resolve(code: number): ResolvedContractError | null {
    const entry: ContractErrorEntry | undefined =
      CONTRACT_ERROR_REGISTRY[code as keyof typeof CONTRACT_ERROR_REGISTRY];
    if (!entry) return null;
    return { code, ...entry };
  }

  /**
   * Return only the human-readable message for a code.
   * Falls back to `'Unknown contract error (code: N)'` for unrecognised codes.
   */
  resolveMessage(code: number): string {
    const entry = this.resolve(code);
    return entry ? entry.message : `Unknown contract error (code: ${code})`;
  }

  /**
   * Returns `true` when the code is present in the registry.
   */
  isKnown(code: number): boolean {
    return code in CONTRACT_ERROR_REGISTRY;
  }

  /**
   * Returns all registered error entries for a given contract name.
   * The `contractName` must match the directory name used as the key in the
   * registry (e.g. `"crowdfund_vault"`, `"vesting-wallet"`).
   */
  byContract(contractName: string): ResolvedContractError[] {
    return Object.entries(CONTRACT_ERROR_REGISTRY)
      .filter(([, entry]) => entry.contract === contractName)
      .map(([code, entry]) => ({ code: Number(code), ...entry }));
  }
}
