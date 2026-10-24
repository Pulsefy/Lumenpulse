import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { Readable } from 'stream';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { RESPONSE_ENVELOPE_HEADER } from './envelope.constants';
import { SkipEnvelope } from './skip-envelope.decorator';

type MockResponse = {
  headersSent: boolean;
  headers: Record<string, string>;
  getHeader: (name: string) => string | undefined;
  setHeader: jest.Mock;
};

function makeResponse(contentType?: string, headersSent = false): MockResponse {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  return {
    headersSent,
    headers,
    getHeader: (name: string) => headers[name.toLowerCase()],
    setHeader: jest.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
  };
}

class PlainController {
  handler() {}
}

@SkipEnvelope()
class SkippedController {
  handler() {}
}

function makeContext(options: {
  headers?: Record<string, string>;
  response?: MockResponse;
  type?: string;
  controller?: new () => { handler: () => void };
}): { context: ExecutionContext; response: MockResponse } {
  const response = options.response ?? makeResponse();
  const Controller = options.controller ?? PlainController;
  const request = {
    headers: options.headers ?? {},
    correlationId: 'corr-1',
  };
  const handler = (Controller.prototype as { handler: () => void }).handler;
  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

const optIn = { 'x-response-envelope': 'v1' };
const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor(new Reflector());

  const run = (ctx: ExecutionContext, value: unknown): Promise<unknown> =>
    lastValueFrom(interceptor.intercept(ctx, handlerReturning(value)));

  it('passes results through untouched without the opt-in header', async () => {
    const { context, response } = makeContext({});
    const body = { id: 'w1' };
    await expect(run(context, body)).resolves.toBe(body);
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('ignores unknown envelope versions', async () => {
    const { context } = makeContext({
      headers: { 'x-response-envelope': 'v2' },
    });
    const body = { id: 'w1' };
    await expect(run(context, body)).resolves.toBe(body);
  });

  it('wraps a single resource with meta when opted in', async () => {
    const { context, response } = makeContext({ headers: optIn });
    const result = (await run(context, { id: 'w1' })) as Record<
      string,
      unknown
    >;
    expect(result).toEqual({
      success: true,
      data: { id: 'w1' },
      meta: { requestId: 'corr-1', timestamp: expect.any(String) },
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      RESPONSE_ENVELOPE_HEADER,
      'v1',
    );
  });

  it('accepts the header case-insensitively', async () => {
    const { context } = makeContext({
      headers: { 'x-response-envelope': ' V1 ' },
    });
    await expect(run(context, 'ok')).resolves.toMatchObject({
      success: true,
      data: 'ok',
    });
  });

  it('turns an undefined result into data: null', async () => {
    const { context } = makeContext({ headers: optIn });
    await expect(run(context, undefined)).resolves.toMatchObject({
      success: true,
      data: null,
    });
  });

  it('lifts a paginated result into data plus pagination meta', async () => {
    const { context } = makeContext({ headers: optIn });
    const result = await run(context, {
      items: [{ id: 1 }, { id: 2 }],
      total: 45,
      page: 2,
      limit: 20,
    });
    expect(result).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      meta: {
        requestId: 'corr-1',
        timestamp: expect.any(String),
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      },
    });
  });

  it('skips handlers marked with @SkipEnvelope()', async () => {
    const { context } = makeContext({
      headers: optIn,
      controller: SkippedController,
    });
    const body = { status: 'ok' };
    await expect(run(context, body)).resolves.toBe(body);
  });

  it('skips non-HTTP contexts', async () => {
    const { context } = makeContext({ headers: optIn, type: 'ws' });
    const body = { event: 'price' };
    await expect(run(context, body)).resolves.toBe(body);
  });

  it.each([
    ['text/plain; version=0.0.4'],
    ['text/csv'],
    ['text/event-stream'],
    ['application/octet-stream'],
    ['application/pdf'],
  ])('does not wrap %s responses', async (contentType) => {
    const { context } = makeContext({
      headers: optIn,
      response: makeResponse(contentType),
    });
    await expect(run(context, 'raw')).resolves.toBe('raw');
  });

  it('does not wrap when the handler already sent the response', async () => {
    const { context } = makeContext({
      headers: optIn,
      response: makeResponse(undefined, true),
    });
    await expect(run(context, undefined)).resolves.toBeUndefined();
  });

  it('does not wrap files, streams or buffers', async () => {
    const file = new StreamableFile(Buffer.from('x'));
    const stream = Readable.from(['x']);
    const buffer = Buffer.from('x');
    for (const value of [file, stream, buffer]) {
      const { context } = makeContext({ headers: optIn });
      await expect(run(context, value)).resolves.toBe(value);
    }
  });
});
