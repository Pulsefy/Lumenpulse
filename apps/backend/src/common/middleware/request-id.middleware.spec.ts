import { RequestIdMiddleware } from './request-id.middleware';
import { RequestContextService } from '../services/request-context.service';
import { REQUEST_ID_HEADER } from '../constants/request.constants';

describe('RequestIdMiddleware', () => {
  const mockRequestContextService = {
    run: jest.fn((_context: unknown, fn: () => void): void => {
      fn();
    }),
  };

  const middleware = new RequestIdMiddleware(
    mockRequestContextService as unknown as RequestContextService,
  );

  it('reuses incoming x-request-id and echoes it back in response header', () => {
    const req = {
      header: jest.fn().mockReturnValue('abc-123'),
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(mockRequestContextService.run).toHaveBeenCalledWith(
      { requestId: 'abc-123' },
      expect.any(Function),
    );
    expect(req.requestId).toBe('abc-123');
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'abc-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('creates a request id when one is not provided', () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
    } as any;
    const res = {
      setHeader: jest.fn(),
    } as any;

    middleware.use(req, res, () => undefined);

    expect(mockRequestContextService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
      }),
      expect.any(Function),
    );
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId).not.toHaveLength(0);
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      req.requestId,
    );
  });
});
