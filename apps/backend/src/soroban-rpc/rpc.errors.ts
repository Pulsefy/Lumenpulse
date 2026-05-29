
export enum RpcErrorCode {
  RPC_ERROR = 'RPC_ERROR',
  HTTP_ERROR = 'HTTP_ERROR',
  TIMEOUT = 'TIMEOUT',
  RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED',
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  PARSE_ERROR = 'PARSE_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/** HTTP status to return for each code (used by the exception filter). */
export const RPC_ERROR_HTTP_STATUS: Record<RpcErrorCode, number> = {
  [RpcErrorCode.TIMEOUT]: 504,
  [RpcErrorCode.RETRIES_EXHAUSTED]: 503,
  [RpcErrorCode.NETWORK_UNAVAILABLE]: 503,
  [RpcErrorCode.RPC_ERROR]: 502,
  [RpcErrorCode.HTTP_ERROR]: 502,
  [RpcErrorCode.PARSE_ERROR]: 502,
  [RpcErrorCode.UNKNOWN]: 500,
};

export class RpcError extends Error {
  public readonly code: RpcErrorCode;
  public readonly httpStatus?: number;
  public readonly rpcCode?: number;
  public override readonly cause?: unknown;

  constructor(opts: {
    message: string;
    code: RpcErrorCode;
    httpStatus?: number;
    rpcCode?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'RpcError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.rpcCode = opts.rpcCode;
    this.cause = opts.cause;
  }

  /** Serialise to a shape suitable for API error responses. */
  toApiError(): {
    error: string;
    code: string;
    rpcCode?: number;
    httpStatus?: number;
  } {
    return {
      error: this.message,
      code: this.code,
      ...(this.rpcCode !== undefined && { rpcCode: this.rpcCode }),
      ...(this.httpStatus !== undefined && { httpStatus: this.httpStatus }),
    };
  }
}