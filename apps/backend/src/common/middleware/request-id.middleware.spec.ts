import { RequestIdMiddleware } from './request-id.middleware';
import { RequestContextService } from '../services/request-context.service';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from '../constants/request.constants';

describe('RequestIdMiddleware', () => {
  const mockRequestContextService = {
    run: jest.fn((_context: unknown, fn: () => void): void => {
      fn();
    }),
  };

  const middleware = new RequestIdMiddleware(
    mockRequestContextService as unknown as RequestContextService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses incoming x-correlation-id and echoes it back in both headers', () => {
    const req = {
      header: jest.fn((name: string) => {
        if (name === 'x-correlation-id') return 'corr-123';
        return undefined;
      }),
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(mockRequestContextService.run).toHaveBeenCalledWith(
      { correlationId: 'corr-123', requestId: 'corr-123' },
      expect.any(Function),
    );
    expect(req.correlationId).toBe('corr-123');
    expect(req.requestId).toBe('corr-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      'corr-123',
    );
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'corr-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses incoming x-request-id when x-correlation-id is not provided', () => {
    const req = {
      header: jest.fn((name: string) => {
        if (name === 'x-request-id') return 'req-456';
        return undefined;
      }),
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(mockRequestContextService.run).toHaveBeenCalledWith(
      { correlationId: 'req-456', requestId: 'req-456' },
      expect.any(Function),
    );
    expect(req.correlationId).toBe('req-456');
    expect(req.requestId).toBe('req-456');
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      'req-456',
    );
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'req-456');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('creates a correlation id when one is not provided', () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;

    middleware.use(req, res, () => undefined);

    expect(mockRequestContextService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: expect.any(String),
        requestId: expect.any(String),
      }),
      expect.any(Function),
    );
    expect(typeof req.correlationId).toBe('string');
    expect(req.correlationId).not.toHaveLength(0);
    expect(req.requestId).toBe(req.correlationId);
    expect(res.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      req.correlationId,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      req.requestId,
    );
  });
});
