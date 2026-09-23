import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import {
  CACHE_KEY_METADATA,
  CACHE_MANAGER,
  CACHE_TTL_METADATA,
} from '@nestjs/cache-manager';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import type { Cache } from 'cache-manager';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { CacheService } from './cache.service';

type CacheKeyFactory = (context: ExecutionContext) => string;

type HttpRequestLike = {
  method?: string;
  url?: string;
};

type HttpResponseLike = Record<string, unknown>;

type HttpAdapterLike = {
  getRequestUrl: (request: unknown) => string;
  getRequestMethod: (request: unknown) => string;
  setHeader: (response: unknown, name: string, value: string) => void;
};

/**
 * CacheInterceptor with the application cache facade's invalidation and
 * metrics hooks.  Nest's built-in interceptor has no way to observe a miss or
 * prevent an in-flight response from being written after an invalidation.
 */
interface InFlightResponse {
  generation: number;
  observable: Observable<unknown>;
}

@Injectable()
export class ObservedCacheInterceptor implements NestInterceptor {
  private readonly allowedMethods = ['GET'];
  private readonly inFlightResponses = new Map<string, InFlightResponse>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly reflector: Reflector,
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const key = this.trackBy(context);
    if (!key) return next.handle();

    const ttlValueOrFactory =
      this.reflector.get<
        number | ((ctx: ExecutionContext) => number | Promise<number>)
      >(CACHE_TTL_METADATA, context.getHandler()) ??
      this.reflector.get<
        number | ((ctx: ExecutionContext) => number | Promise<number>)
      >(CACHE_TTL_METADATA, context.getClass()) ??
      null;
    const generationAtRead = this.cacheService?.getGeneration(key) ?? 0;

    return this.cacheManager.get(key).then(
      async (value) => {
        this.cacheService?.trackKey(key);
        const generationCurrent =
          this.cacheService?.isGenerationCurrent(key, generationAtRead) ?? true;
        const isHit =
          value !== undefined &&
          value !== null &&
          generationCurrent &&
          (this.cacheService?.isKeyFresh(key) ?? true);
        this.setHeadersWhenHttp(context, isHit ? value : undefined);
        if (isHit) {
          this.cacheService?.recordCacheHit(key);
          return of(value);
        }

        if (value !== undefined && generationCurrent) {
          await this.cacheManager.del(key);
        }
        this.cacheService?.recordCacheMiss(key);
        const generation = this.cacheService?.getGeneration(key) ?? 0;
        const existing = this.inFlightResponses.get(key);
        if (existing && existing.generation === generation) {
          return existing.observable;
        }

        const response$: Observable<unknown> = next.handle().pipe(
          tap((response) => {
            void this.storeResponse(
              key,
              response,
              generation,
              ttlValueOrFactory,
              context,
            );
          }),
          finalize(() => {
            if (this.inFlightResponses.get(key)?.observable === response$) {
              this.inFlightResponses.delete(key);
            }
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
        this.inFlightResponses.set(key, { generation, observable: response$ });
        return response$;
      },
      () => next.handle(),
    );
  }

  private async storeResponse(
    key: string,
    response: unknown,
    generation: number,
    ttlValueOrFactory:
      | number
      | ((ctx: ExecutionContext) => number | Promise<number>)
      | null,
    context: ExecutionContext,
  ): Promise<void> {
    if (response instanceof StreamableFile) return;

    try {
      if (
        this.cacheService &&
        !this.cacheService.isGenerationCurrent(key, generation)
      ) {
        this.cacheService.recordCacheFillRacePrevented(key);
        return;
      }
      const ttl = await this.resolveTtl(ttlValueOrFactory, context);
      await this.cacheManager.set(key, response, ttl ?? undefined);
      if (
        this.cacheService &&
        !this.cacheService.isGenerationCurrent(key, generation)
      ) {
        await this.cacheManager.del(key);
        this.cacheService.recordCacheFillRacePrevented(key);
        return;
      }
      this.cacheService?.recordCacheFill(key);
    } catch {
      // Cache writes are best effort; the request response must not fail
      // because telemetry or Redis is unavailable.
    }
  }

  /** Public for focused interceptor tests and custom integrations. */
  recordCacheFillRacePrevented(key: string): void {
    // CacheService intentionally keeps the counter implementation private;
    // this method gives the interceptor a stable hook without exposing cache
    // manager details to callers.
    this.cacheService?.recordCacheFillRacePrevented(key);
  }

  private trackBy(context: ExecutionContext): string | undefined {
    const cacheMetadataOrFactory =
      this.reflector.get<CacheKeyFactory | string>(
        CACHE_KEY_METADATA,
        context.getHandler(),
      ) ??
      this.reflector.get<CacheKeyFactory | string>(
        CACHE_KEY_METADATA,
        context.getClass(),
      );

    const httpAdapter = this.httpAdapterHost.httpAdapter as
      | HttpAdapterLike
      | undefined;
    const isHttpApp =
      httpAdapter && typeof httpAdapter.getRequestMethod === 'function';
    if (!isHttpApp || cacheMetadataOrFactory) {
      return typeof cacheMetadataOrFactory === 'function'
        ? cacheMetadataOrFactory(context)
        : cacheMetadataOrFactory;
    }

    const request = context.getArgByIndex<HttpRequestLike>(0);
    if (!this.isRequestCacheable(context)) return undefined;
    return httpAdapter.getRequestUrl(request);
  }

  private isRequestCacheable(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    return (
      typeof request.method === 'string' &&
      this.allowedMethods.includes(request.method)
    );
  }

  private setHeadersWhenHttp(context: ExecutionContext, value: unknown): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter as
      | HttpAdapterLike
      | undefined;
    if (!httpAdapter) return;
    const response = context.switchToHttp().getResponse<HttpResponseLike>();
    httpAdapter.setHeader(
      response,
      'X-Cache',
      value === undefined || value === null ? 'MISS' : 'HIT',
    );
  }

  private async resolveTtl(
    ttl: number | ((ctx: ExecutionContext) => number | Promise<number>) | null,
    context: ExecutionContext,
  ): Promise<number | undefined> {
    return typeof ttl === 'function' ? ttl(context) : (ttl ?? undefined);
  }
}
