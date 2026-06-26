export interface ErrorDetail {
  field?: string;
  message: string;
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: ErrorDetail[] | Record<string, unknown>;
  requestId: string;
}
