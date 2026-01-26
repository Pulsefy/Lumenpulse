import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SentimentService } from '../src/sentiment/sentiment.service';
import {
  SentimentResponse,
  HealthResponse,
} from '../src/sentiment/sentiment.service';

interface ErrorResponse {
  message: string | string[];
  error?: string;
  statusCode: number;
}

describe('SentimentController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let sentimentService: SentimentService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    server = app.getHttpServer() as unknown as Server;
    sentimentService = moduleFixture.get(SentimentService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /sentiment/analyze', () => {
    it('should analyze sentiment successfully', async () => {
      const mockResponse: SentimentResponse = { sentiment: 0.85 };

      jest
        .spyOn(sentimentService, 'analyzeSentiment')
        .mockResolvedValue(mockResponse);

      const res = await request(server)
        .post('/sentiment/analyze')
        .send({ text: 'This is amazing!' })
        .expect(201);

      const body = res.body as SentimentResponse;

      expect(body.sentiment).toBeGreaterThanOrEqual(-1);
      expect(body.sentiment).toBeLessThanOrEqual(1);
    });

    it('should return 400 for empty text', async () => {
      const res = await request(server)
        .post('/sentiment/analyze')
        .send({ text: '' })
        .expect(400);

      const body = res.body as ErrorResponse;

      const message =
        typeof body.message === 'string'
          ? body.message
          : body.message.join(' ');

      expect(message).toContain('Text cannot be empty');
    });

    it('should return 400 for whitespace-only text', async () => {
      await request(server)
        .post('/sentiment/analyze')
        .send({ text: '   ' })
        .expect(400);
    });
  });

  describe('GET /sentiment/health', () => {
    it('should return health status', async () => {
      const mockResponse: HealthResponse = {
        status: 'healthy',
        timestamp: '2024-01-01T12:00:00Z',
        service: 'sentiment-analysis',
      };

      jest
        .spyOn(sentimentService, 'checkHealth')
        .mockResolvedValue(mockResponse);

      const res = await request(server).get('/sentiment/health').expect(200);

      const body = res.body as HealthResponse;

      expect(body.status).toBe('healthy');
      expect(body.service).toBe('sentiment-analysis');
    });
  });
});

