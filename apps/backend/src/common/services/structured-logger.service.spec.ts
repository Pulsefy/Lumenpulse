import { Test, TestingModule } from '@nestjs/testing';
import { StructuredLogger, LogContext } from './structured-logger.service';

describe('StructuredLogger', () => {
  let logger: StructuredLogger;

  beforeEach(() => {
    logger = new StructuredLogger('TestContext', {
      includeRequestDetails: true,
      excludePaths: ['/health'],
    });
  });

  describe('Basic Logging', () => {
    it('should create a logger with default context', () => {
      const defaultLogger = new StructuredLogger();
      expect(defaultLogger).toBeDefined();
    });

    it('should log info messages with correct structure', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger.logInfo('Test message', { requestId: 'test-123' });
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.message).toBe('Test message');
      expect(loggedData.level).toBe('info');
      expect(loggedData.context).toBe('TestContext');
      expect(loggedData.requestId).toBe('test-123');
      
      consoleSpy.mockRestore();
    });

    it('should log warn messages with correct level', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      logger.logWarn('Warning message', { requestId: 'test-456' });
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.level).toBe('warn');
      expect(loggedData.message).toBe('Warning message');
      
      consoleSpy.mockRestore();
    });

    it('should log error messages with correct level', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      logger.logError('Error message', { requestId: 'test-789' });
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.level).toBe('error');
      expect(loggedData.message).toBe('Error message');
      
      consoleSpy.mockRestore();
    });

    it('should log debug messages with correct level', () => {
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();
      
      logger.logDebug('Debug message', { requestId: 'test-101' });
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.level).toBe('debug');
      expect(loggedData.message).toBe('Debug message');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Context Management', () => {
    it('should allow changing context', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger.setContext('NewContext');
      logger.logInfo('Test');
      
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.context).toBe('NewContext');
      
      consoleSpy.mockRestore();
    });

    it('should include custom context fields', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const customContext: LogContext = {
        requestId: 'req-123',
        userId: 'user-456',
        correlationId: 'corr-789',
      };
      
      logger.logInfo('Test with context', customContext);
      
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.requestId).toBe('req-123');
      expect(loggedData.userId).toBe('user-456');
      expect(loggedData.correlationId).toBe('corr-789');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Metadata', () => {
    it('should include metadata in log entries', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger.logInfo('Test with metadata', {}, { key: 'value', count: 42 });
      
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.metadata).toEqual({ key: 'value', count: 42 });
      
      consoleSpy.mockRestore();
    });
  });

  describe('Request Filtering', () => {
    it('should not log excluded paths', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockReq = { url: '/health' } as any;
      const mockRes = {} as any;
      
      logger.logInfo('Should not log', {}, {}, mockReq, mockRes);
      
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should log non-excluded paths', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockReq = { url: '/api/users' } as any;
      const mockRes = {} as any;
      
      logger.logInfo('Should log', {}, {}, mockReq, mockRes);
      
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('NestJS LoggerService Compatibility', () => {
    it('should implement NestJS LoggerService interface', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Test log() method
      logger.log('Test message');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should implement error() method with trace', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      logger.error('Error message', 'Stack trace here');
      expect(consoleSpy).toHaveBeenCalled();
      
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.message).toContain('Error message');
      expect(loggedData.message).toContain('Stack trace here');
      
      consoleSpy.mockRestore();
    });

    it('should implement warn() method', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      logger.warn('Warning message');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should implement debug() method', () => {
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();
      
      logger.debug('Debug message');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should implement verbose() method', () => {
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();
      
      logger.verbose('Verbose message');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Timestamp', () => {
    it('should include ISO timestamp in all log entries', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger.logInfo('Test timestamp');
      
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(loggedData.timestamp).toBeDefined();
      expect(new Date(loggedData.timestamp).toISOString()).toBe(loggedData.timestamp);
      
      consoleSpy.mockRestore();
    });
  });
});