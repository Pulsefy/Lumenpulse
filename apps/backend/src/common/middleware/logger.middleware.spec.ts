import { Logger } from '@nestjs/common';
import { LoggerMiddleware } from './logger.middleware';

describe('LoggerMiddleware', () => {
  const middleware = new LoggerMiddleware();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs structured JSON with request correlation id', () => {
    const logSpy = jest.spyOn(Logger, 'log').mockImplementation();
    const req = {
      method: 'GET',
      url: '/v1/config/stellar',
      originalUrl: '/v1/config/stellar',
      requestId: 'req-123',
    } as any;
    const res = {
      statusCode: 200,
      end: jest.fn(),
    } as any;

    middleware.use(req, res, () => undefined);
    res.end();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [payload, context] = logSpy.mock.calls[0];
    expect(context).toBe('HTTP');
    expect(typeof payload).toBe('string');

    const parsed = JSON.parse(payload as string);
    expect(parsed).toMatchObject({
      event: 'http_request_completed',
      requestId: 'req-123',
      method: 'GET',
      url: '/v1/config/stellar',
      statusCode: 200,
    });
    expect(typeof parsed.durationMs).toBe('number');
  });
});
