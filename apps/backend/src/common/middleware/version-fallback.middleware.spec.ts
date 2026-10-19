import {
  VersionFallbackMiddleware,
  API_TRANSITION_SUNSET_DATE,
} from './version-fallback.middleware';
import { Request, Response, NextFunction } from 'express';

describe('VersionFallbackMiddleware', () => {
  let middleware: VersionFallbackMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let headersSet: Record<string, string>;

  beforeEach(() => {
    middleware = new VersionFallbackMiddleware();
    headersSet = {};
    mockResponse = {
      setHeader: jest.fn((key: string, value: string) => {
        headersSet[key] = value;
        return mockResponse as Response;
      }),
    };
    nextFunction = jest.fn();
  });

  it('should leave already versioned routes (/v1/projects) unchanged and not set deprecation headers', () => {
    mockRequest = {
      url: '/v1/projects',
      path: '/v1/projects',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/v1/projects');
    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should leave already versioned routes (/v2/auth) unchanged', () => {
    mockRequest = {
      url: '/v2/auth',
      path: '/v2/auth',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/v2/auth');
    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should leave excluded routes like /api/docs untouched', () => {
    mockRequest = {
      url: '/api/docs',
      path: '/api/docs',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/api/docs');
    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should leave excluded routes like /health untouched', () => {
    mockRequest = {
      url: '/health',
      path: '/health',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/health');
    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should leave root / untouched', () => {
    mockRequest = {
      url: '/',
      path: '/',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/');
    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should rewrite unversioned routes (/projects) to /v1/projects and set deprecation headers', () => {
    mockRequest = {
      url: '/projects',
      path: '/projects',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/v1/projects');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Sunset',
      API_TRANSITION_SUNSET_DATE,
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Link',
      '</v1/projects>; rel="successor-version"',
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should preserve query parameters when rewriting unversioned route', () => {
    mockRequest = {
      url: '/news?limit=10&page=2',
      path: '/news',
    };

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockRequest.url).toBe('/v1/news?limit=10&page=2');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Link',
      '</v1/news>; rel="successor-version"',
    );
    expect(nextFunction).toHaveBeenCalled();
  });
});
