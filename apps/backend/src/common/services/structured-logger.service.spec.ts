import { StructuredLoggerService } from './structured-logger.service';
import { RequestContextService } from './request-context.service';

describe('StructuredLoggerService', () => {
  let logger: StructuredLoggerService;

  beforeEach(() => {
    logger = new StructuredLoggerService('TestContext');
  });

  it('formats plain string messages into structured JSON containing correlationId', () => {
    const output = RequestContextService.run(
      { correlationId: 'test-corr-abc' },
      () => {
        return logger.formatStructured('log', 'User created successfully');
      },
    );

    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      level: 'log',
      context: 'TestContext',
      correlationId: 'test-corr-abc',
      requestId: 'test-corr-abc',
      message: 'User created successfully',
    });
    expect(parsed.timestamp).toBeDefined();
  });

  it('augments JSON objects with correlationId and context', () => {
    const output = RequestContextService.run(
      { correlationId: 'test-corr-xyz' },
      () => {
        return logger.formatStructured('warn', {
          event: 'insufficient_funds',
          account: 'GABC...',
          balance: 10,
        });
      },
    );

    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      event: 'insufficient_funds',
      account: 'GABC...',
      balance: 10,
      correlationId: 'test-corr-xyz',
      requestId: 'test-corr-xyz',
      level: 'warn',
      context: 'TestContext',
    });
  });

  it('augments serialized JSON string with correlationId if missing', () => {
    const output = RequestContextService.run(
      { correlationId: 'test-corr-json' },
      () => {
        return logger.formatStructured(
          'error',
          JSON.stringify({
            event: 'transaction_failed',
            reason: 'timeout',
          }),
        );
      },
    );

    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      event: 'transaction_failed',
      reason: 'timeout',
      correlationId: 'test-corr-json',
      requestId: 'test-corr-json',
      level: 'error',
    });
  });

  it('defaults correlationId to "unknown" when outside request context', () => {
    const output = logger.formatStructured('log', 'Background task started');
    const parsed = JSON.parse(output);
    expect(parsed.correlationId).toBe('unknown');
    expect(parsed.requestId).toBe('unknown');
  });
});
