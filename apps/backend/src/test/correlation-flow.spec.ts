import { RequestIdMiddleware } from '../common/middleware/request-id.middleware';
import { RequestContextService } from '../common/services/request-context.service';
import { StructuredLoggerService } from '../common/services/structured-logger.service';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxEvent, OutboxEventStatus } from '../outbox/outbox-event.entity';
import { SuspiciousContributionProcessor } from '../suspicious-contribution/suspicious-contribution.processor';
import { SentimentService } from '../sentiment/sentiment.service';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from '../common/constants/request.constants';
import { ErrorCode } from '../common/enums/error-code.enum';
import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';

describe('End-to-End Correlation ID Tracing: Worked Example (#1421)', () => {
  let requestContextService: RequestContextService;
  let structuredLogger: StructuredLoggerService;
  let requestIdMiddleware: RequestIdMiddleware;
  let exceptionFilter: GlobalExceptionFilter;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    requestContextService.onModuleInit();
    structuredLogger = new StructuredLoggerService('CorrelationTraceDemo');
    requestIdMiddleware = new RequestIdMiddleware(requestContextService);
    exceptionFilter = new GlobalExceptionFilter();
  });

  it('traces a user contribution across API -> Outbox -> Queue Worker -> Python Service with consistent correlation ID', async () => {
    const traceLogs: Record<string, any>[] = [];
    const recordLog = (step: string, level: string, message: any) => {
      const formatted = structuredLogger.formatStructured(level, {
        step,
        traceEvent: message,
      });
      traceLogs.push(JSON.parse(formatted));
    };

    const clientProvidedCorrelationId = 'c8f3077e-28b9-4674-8b65-6831d10e5d62';

    // ──────────────────────────────────────────────────────────────────────────
    // Component 1: Inbound HTTP API Request
    // ──────────────────────────────────────────────────────────────────────────
    const incomingReq = {
      method: 'POST',
      url: '/v1/contributions',
      header: (h: string) => {
        if (h === 'x-correlation-id') return clientProvidedCorrelationId;
        return undefined;
      },
    } as any;

    const responseHeaders: Record<string, string> = {};
    const apiRes = {
      setHeader: (name: string, val: string) => {
        responseHeaders[name] = val;
      },
    } as any;

    let apiExecuted = false;
    await new Promise<void>((resolve, reject) => {
      requestIdMiddleware.use(incomingReq, apiRes, () => {
        void (async () => {
          try {
            apiExecuted = true;
            expect(RequestContextService.getCorrelationId()).toBe(
              clientProvidedCorrelationId,
            );
            expect(responseHeaders[CORRELATION_ID_HEADER]).toBe(
              clientProvidedCorrelationId,
            );
            expect(responseHeaders[REQUEST_ID_HEADER]).toBe(
              clientProvidedCorrelationId,
            );

            recordLog('1_API_INBOUND', 'log', {
              msg: 'Inbound contribution request received',
              contributor: 'GABC123...',
              roundId: 1,
            });

            // ──────────────────────────────────────────────────────────────────────
            // Component 2: Transactional Outbox Event Publishing
            // ──────────────────────────────────────────────────────────────────────
            const mockRepo = {
              create: jest.fn((dto: unknown) => dto as OutboxEvent),
              save: jest.fn((e: unknown) =>
                Promise.resolve({
                  ...(e as Record<string, unknown>),
                  id: 'outbox-evt-101',
                } as unknown as OutboxEvent),
              ),
              find: jest.fn(),
              countBy: jest.fn().mockResolvedValue(0),
            };
            const mockJobLock = {
              tryAcquire: jest.fn().mockResolvedValue(true),
              release: jest.fn().mockResolvedValue(undefined),
            };
            const mockMetrics = {
              setOutboxRelayLagSeconds: jest.fn(),
              recordOutboxAttempt: jest.fn(),
              setOutboxDeadLetterVolume: jest.fn(),
            };

            const outboxService = new OutboxService(
              mockRepo as any,
              mockJobLock as any,
              mockMetrics as any,
            );

            const publishedEvent = await outboxService.publish(
              'contribution.created',
              {
                contributor: 'GABC123...',
                roundId: 1,
                amount: '500',
              },
            );

            expect(publishedEvent.correlationId).toBe(
              clientProvidedCorrelationId,
            );
            recordLog('2_OUTBOX_PUBLISH', 'log', {
              msg: 'Outbox event staged within database transaction',
              eventId: 'outbox-evt-101',
              eventType: publishedEvent.eventType,
            });

            // ──────────────────────────────────────────────────────────────────────
            // Component 3: Outbox Poller & Dispatch
            // ──────────────────────────────────────────────────────────────────────
            const outboxEventRecord: OutboxEvent = {
              ...publishedEvent,
              id: 'outbox-evt-101',
              attempts: 0,
              status: OutboxEventStatus.PENDING,
              createdAt: new Date(),
              lastError: null,
              processedAt: null,
              deadLetterAt: null,
            };

            mockRepo.find.mockResolvedValue([outboxEventRecord]);

            let queuedBullMqJobData: any = null;
            outboxService.registerHandler(async (_eventType, payload) => {
              recordLog('3_OUTBOX_RELAY_DISPATCH', 'log', {
                msg: 'Outbox poller dispatched event to consumer',
                correlationId: RequestContextService.getCorrelationId(),
              });

              // Handlers enqueue queue jobs with correlation context
              queuedBullMqJobData = {
                ...payload,
                correlationId: RequestContextService.getCorrelationId(),
              };
              await Promise.resolve();
            });

            await outboxService.pollAndDispatch();
            expect(queuedBullMqJobData).toBeDefined();
            expect(queuedBullMqJobData.correlationId).toBe(
              clientProvidedCorrelationId,
            );

            // ──────────────────────────────────────────────────────────────────────
            // Component 4: BullMQ Queue Worker
            // ──────────────────────────────────────────────────────────────────────
            let pythonServiceHeaderReceived: string | null = null;
            const mockDetectionService = {
              detect: jest.fn(async () => {
                recordLog('4_QUEUE_WORKER_EXECUTION', 'log', {
                  msg: 'Fraud detector evaluating contribution in background job',
                  correlationId: RequestContextService.getCorrelationId(),
                });

                // ──────────────────────────────────────────────────────────────────
                // Component 5: Outbound Call to Python Service
                // ──────────────────────────────────────────────────────────────────
                const mockHttpService = {
                  post: jest.fn((_url: string, _body: any, config: any) => {
                    pythonServiceHeaderReceived =
                      config.headers?.[CORRELATION_ID_HEADER];
                    return of({ data: { sentiment: 0.95 } });
                  }),
                };
                const mockConfigService = {
                  get: jest.fn().mockReturnValue('http://localhost:8000'),
                };

                const sentimentService = new SentimentService(
                  mockHttpService as any,
                  mockConfigService as any,
                );

                await sentimentService.analyzeSentiment(
                  'Contribution note: legit grant donation',
                );

                recordLog('5_PYTHON_SERVICE_OUTBOUND', 'log', {
                  msg: 'Dispatched outbound call to Python service',
                  target: 'http://localhost:8000/analyze',
                  correlationId: RequestContextService.getCorrelationId(),
                });

                return [];
              }),
            };

            const mockModerationService = {
              createReport: jest.fn(),
            };

            const processor = new SuspiciousContributionProcessor(
              mockDetectionService as any,
              mockModerationService as any,
            );

            const bullJob = {
              id: 'bull-job-555',
              data: queuedBullMqJobData,
            } as any;

            await processor.process(bullJob);

            expect(pythonServiceHeaderReceived).toBe(
              clientProvidedCorrelationId,
            );
            resolve();
          } catch (err: unknown) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });
    });

    expect(apiExecuted).toBe(true);

    // ──────────────────────────────────────────────────────────────────────────
    // Verification: Every single structured log across all hops carried the ID
    // ──────────────────────────────────────────────────────────────────────────
    expect(traceLogs.length).toBe(5);
    for (const log of traceLogs) {
      expect(log.correlationId).toBe(clientProvidedCorrelationId);
      expect(log.requestId).toBe(clientProvidedCorrelationId);
      expect(log.timestamp).toBeDefined();
    }
  });

  it('returns correlation ID in error responses and headers for report quoting', () => {
    const correlationId = 'err-report-quote-987';
    const mockReq = {
      method: 'POST',
      url: '/v1/contributions',
      correlationId,
      requestId: correlationId,
    };
    const responseHeaders: Record<string, string> = {};
    let responseBody: any = null;

    const mockRes = {
      setHeader: (name: string, val: string) => {
        responseHeaders[name] = val;
      },
      status: jest.fn().mockReturnThis(),
      json: (body: any) => {
        responseBody = body;
      },
    };

    const host = {
      switchToHttp: () => ({
        getRequest: () => mockReq,
        getResponse: () => mockRes,
      }),
    } as any;

    exceptionFilter.catch(
      new BadRequestException('Contribution amount exceeds maximum grant pool'),
      host,
    );

    expect(responseHeaders[CORRELATION_ID_HEADER]).toBe(correlationId);
    expect(responseHeaders[REQUEST_ID_HEADER]).toBe(correlationId);
    expect(responseBody).toMatchObject({
      code: ErrorCode.SYS_BAD_REQUEST,
      message: 'Contribution amount exceeds maximum grant pool',
      correlationId,
      requestId: correlationId,
    });
  });
});
