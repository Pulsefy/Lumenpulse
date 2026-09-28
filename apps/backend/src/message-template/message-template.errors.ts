export type MessageTemplateRenderErrorCode =
  | 'UNKNOWN_TEMPLATE'
  | 'MALFORMED_TEMPLATE'
  | 'MISSING_VARIABLE'
  | 'INVALID_VARIABLE';

export class MessageTemplateRenderError extends Error {
  constructor(
    message: string,
    public readonly code: MessageTemplateRenderErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MessageTemplateRenderError';
  }
}
