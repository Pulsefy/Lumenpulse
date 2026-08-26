import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface ErrorInfo {
  contract: string;
  enum: string;
  variant: string;
  message: string;
}

interface ErrorReference {
  version: string;
  generated_at: string;
  contracts: Record<string, ContractErrorData>;
  code_to_error: Record<string, ErrorInfo>;
  allocation_ranges: Record<string, [number, number]>;
}

interface ContractErrorData {
  enum_name: string;
  range: [number, number];
  errors: Record<string, { code: number; message: string }>;
}

/**
 * Service to resolve contract error codes to human-readable messages.
 * 
 * This service loads the generated error reference mapping and provides
 * methods to resolve error codes to their contract, variant, and message.
 */
@Injectable()
export class ErrorResolverService {
  private readonly logger = new Logger(ErrorResolverService.name);
  private errorReference: ErrorReference | null = null;
  private readonly referencePath = path.join(
    __dirname,
    '../../../error_reference.json',
  );

  constructor() {
    this.loadErrorReference();
  }

  /**
   * Load the error reference JSON file.
   */
  private loadErrorReference(): void {
    try {
      if (fs.existsSync(this.referencePath)) {
        const data = fs.readFileSync(this.referencePath, 'utf-8');
        const parsed: unknown = JSON.parse(data);
        if (this.isValidErrorReference(parsed)) {
          this.errorReference = parsed;
          this.logger.log(
            `Loaded error reference: ${Object.keys(this.errorReference.contracts || {}).length} contracts, ${Object.keys(this.errorReference.code_to_error || {}).length} error codes`,
          );
        } else {
          this.logger.warn(
            `Error reference file has an unexpected format: ${this.referencePath}`,
          );
        }
      } else {
        this.logger.warn(
          `Error reference file not found at ${this.referencePath}`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to load error reference', error);
    }
  }

  /**
   * Type guard to validate the error reference structure.
   */
  private isValidErrorReference(obj: unknown): obj is ErrorReference {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    if (
      typeof o.version !== 'string' ||
      typeof o.generated_at !== 'string'
    )
      return false;
    if (typeof o.contracts !== 'object' || o.contracts === null) return false;
    if (typeof o.code_to_error !== 'object' || o.code_to_error === null)
      return false;
    if (
      typeof o.allocation_ranges !== 'object' ||
      o.allocation_ranges === null
    )
      return false;
    return true;
  }

  /**
   * Resolve an error code to its human-readable message.
   * 
   * @param code - The numeric error code from the contract
   * @returns Error information or null if code not found
   */
  resolveError(code: number): ErrorInfo | null {
    if (!this.errorReference) {
      this.logger.warn('Error reference not loaded');
      return null;
    }

    const codeStr = code.toString();
    const errorInfo = this.errorReference.code_to_error[codeStr];

    if (!errorInfo) {
      this.logger.warn(`Unknown error code: ${code}`);
      return null;
    }

    return errorInfo;
  }

  /**
   * Resolve an error code to a formatted message string.
   * 
   * @param code - The numeric error code from the contract
   * @returns Formatted error message or fallback string
   */
  resolveErrorMessage(code: number): string {
    const errorInfo = this.resolveError(code);

    if (!errorInfo) {
      return `Unknown error code: ${code}`;
    }

    return `[${errorInfo.contract}::${errorInfo.variant}] ${errorInfo.message}`;
  }

  /**
   * Get all errors for a specific contract.
   * 
   * @param contractName - The name of the contract (e.g., 'crowdfund_vault')
   * @returns Contract error data or null if contract not found
   */
  getContractErrors(contractName: string): ContractErrorData | null {
    if (!this.errorReference) {
      return null;
    }

    return this.errorReference.contracts[contractName] || null;
  }

  /**
   * Get the allocated range for a contract.
   * 
   * @param contractName - The name of the contract
   * @returns [min_code, max_code] or null if contract not found
   */
  getContractRange(contractName: string): [number, number] | null {
    if (!this.errorReference) {
      return null;
    }

    return this.errorReference.allocation_ranges[contractName] || null;
  }

  /**
   * Check if an error code belongs to a specific contract.
   * 
   * @param code - The numeric error code
   * @param contractName - The name of the contract
   * @returns true if the code belongs to the contract's range
   */
  isContractError(code: number, contractName: string): boolean {
    const range = this.getContractRange(contractName);
    if (!range) {
      return false;
    }

    const [min, max] = range;
    return code >= min && code <= max;
  }

  /**
   * Get the contract name for an error code.
   * 
   * @param code - The numeric error code
   * @returns Contract name or null if code not found
   */
  getContractForCode(code: number): string | null {
    const errorInfo = this.resolveError(code);
    return errorInfo?.contract || null;
  }

  /**
   * Reload the error reference (useful for development or hot-reloading).
   */
  reloadErrorReference(): void {
    this.logger.log('Reloading error reference...');
    this.loadErrorReference();
  }

  /**
   * Get the version of the loaded error reference.
   * 
   * @returns Version string or null if not loaded
   */
  getVersion(): string | null {
    return this.errorReference?.version || null;
  }

  /**
   * Get the generation timestamp of the loaded error reference.
   * 
   * @returns ISO timestamp or null if not loaded
   */
  getGeneratedAt(): string | null {
    return this.errorReference?.generated_at || null;
  }
}
