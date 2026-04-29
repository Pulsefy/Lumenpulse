import { Test, TestingModule } from '@nestjs/testing';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };

  const mockRequest = {
    method: 'GET',
    url: '/test-path',
    requestId: 'req-123',
  };

  const mockArgumentsHost = {
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalExceptionFilter],
    }).compile();

    filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('normalizes a standard HttpException', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'req-123',
    );
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith({
      code: ErrorCode.SYS_NOT_FOUND,
      message: 'Not Found',
      details: undefined,
      requestId: 'req-123',
    });
  });

  it('maps unauthorized exceptions to AUTH_001', () => {
    const exception = new UnauthorizedException();

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.AUTH_UNAUTHORIZED,
        requestId: 'req-123',
      }),
    );
  });

  it('preserves validation details in the standardized shape', () => {
    const exception = new BadRequestException({
      code: ErrorCode.SYS_VALIDATION_FAILED,
      message: 'Validation failed',
      details: [{ field: 'email', message: 'Email is required' }],
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      code: ErrorCode.SYS_VALIDATION_FAILED,
      message: 'Validation failed',
      details: [{ field: 'email', message: 'Email is required' }],
      requestId: 'req-123',
    });
  });

  it('still honors existing custom error codes', () => {
    const exception = new HttpException(
      {
        message: 'Custom error',
        errorCode: ErrorCode.STEL_INSUFFICIENT_FUNDS,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.STEL_INSUFFICIENT_FUNDS,
      }),
    );
  });

  it('hides internal error messages in production mode', () => {
    const originalNodeEnv = process['env']['NODE_ENV'];
    process['env']['NODE_ENV'] = 'production';

    filter.catch(new Error('Unexpected database error'), mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith({
      code: ErrorCode.SYS_INTERNAL_ERROR,
      message: 'Internal server error',
      requestId: 'req-123',
    });

    process['env']['NODE_ENV'] = originalNodeEnv;
  });
});
