import { Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    // Custom error response
    response.status(429).json({
      statusCode: 429,
      message: 'Too Many Requests. Please try again later.',
      error: 'Too Many Requests',
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      // Helpful message with retry info
      details: {
        limit: '3 requests per minute',
        suggestion: 'Please wait 1 minute before making more requests',
      }
    });
  }
}