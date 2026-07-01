import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRequestId', () => {
    it('should return "unknown" when outside request context', () => {
      expect(service.getRequestId()).toBe('unknown');
    });

    it('should return requestId when inside request context', () => {
      const result = service.run({ requestId: 'test-123' }, () => {
        return service.getRequestId();
      });

      expect(result).toBe('test-123');
    });

    it('should propagate context through nested calls', () => {
      service.run({ requestId: 'outer-123' }, () => {
        expect(service.getRequestId()).toBe('outer-123');

        // Nested calls should maintain context
        const inner = service.run({ requestId: 'inner-456' }, () => {
          return service.getRequestId();
        });

        expect(inner).toBe('inner-456');
      });
    });
  });

  describe('getContext', () => {
    it('should return undefined when outside request context', () => {
      expect(service.getContext()).toBeUndefined();
    });

    it('should return full context when inside request context', () => {
      const result = service.run(
        { requestId: 'test-123', userId: 'user-456' },
        () => {
          return service.getContext();
        },
      );

      expect(result).toEqual({
        requestId: 'test-123',
        userId: 'user-456',
      });
    });
  });

  describe('set and get', () => {
    it('should set and get values in context', () => {
      service.run({ requestId: 'test-123' }, () => {
        service.set('userId', 'user-456');
        service.set('tenantId', 'tenant-789');

        expect(service.get('userId')).toBe('user-456');
        expect(service.get('tenantId')).toBe('tenant-789');
      });
    });

    it('should return undefined for non-existent keys', () => {
      service.run({ requestId: 'test-123' }, () => {
        expect(service.get('nonExistent')).toBeUndefined();
      });
    });

    it('should not persist values outside request context', () => {
      service.run({ requestId: 'test-123' }, () => {
        service.set('userId', 'user-456');
      });

      // Outside context, get should return undefined
      expect(service.get('userId')).toBeUndefined();
    });
  });

  describe('AsyncLocalStorage isolation', () => {
    it('should isolate contexts between concurrent requests', async () => {
      const promise1 = new Promise<string>((resolve) => {
        service.run({ requestId: 'request-1' }, () => {
          setTimeout(() => {
            resolve(service.getRequestId());
          }, 50);
        });
      });

      const promise2 = new Promise<string>((resolve) => {
        service.run({ requestId: 'request-2' }, () => {
          setTimeout(() => {
            resolve(service.getRequestId());
          }, 10);
        });
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('request-1');
      expect(result2).toBe('request-2');
    });
  });
});
