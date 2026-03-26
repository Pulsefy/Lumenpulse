import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { AiThrottleGuard } from './ai-throttle.guard';
import { AiMetricsService } from './ai-metrics.service';

describe('AiThrottleGuard', () => {
  let guard: AiThrottleGuard;
  let aiMetrics: Partial<AiMetricsService>;

  const mockExecutionContext = (): ExecutionContext => {
    const setHeader = jest.fn();
    return {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    aiMetrics = {
      shouldThrottle: jest.fn(),
      recordThrottledRequest: jest.fn(),
    };
    guard = new AiThrottleGuard(aiMetrics as AiMetricsService);
  });

  it('should allow request when not throttling', () => {
    (aiMetrics.shouldThrottle as jest.Mock).mockReturnValue({
      throttle: false,
      reason: null,
    });

    expect(guard.canActivate(mockExecutionContext())).toBe(true);
    expect(aiMetrics.recordThrottledRequest).not.toHaveBeenCalled();
  });

  it('should throw 503 when throttling is active', () => {
    (aiMetrics.shouldThrottle as jest.Mock).mockReturnValue({
      throttle: true,
      reason: 'Concurrency limit reached (10/10)',
    });

    expect(() => guard.canActivate(mockExecutionContext())).toThrow(
      HttpException,
    );

    try {
      guard.canActivate(mockExecutionContext());
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    expect(aiMetrics.recordThrottledRequest).toHaveBeenCalled();
  });

  it('should set Retry-After header when throttling', () => {
    (aiMetrics.shouldThrottle as jest.Mock).mockReturnValue({
      throttle: true,
      reason: 'High RAM usage',
    });

    const ctx = mockExecutionContext();
    const setHeader = ctx.switchToHttp().getResponse<any>().setHeader;

    try {
      guard.canActivate(ctx);
    } catch {
      // expected
    }

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });
});
