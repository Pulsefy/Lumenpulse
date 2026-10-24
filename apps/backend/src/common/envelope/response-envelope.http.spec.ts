import {
  Controller,
  Get,
  Header,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { SkipEnvelope } from './skip-envelope.decorator';

@Controller('things')
class ThingsController {
  @Get('one')
  one() {
    return { id: 'a' };
  }

  @Get('page')
  page() {
    return { items: [{ id: 'a' }], total: 1, page: 1, limit: 10 };
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('Thing not found');
  }

  @Get('text')
  @Header('Content-Type', 'text/plain')
  text() {
    return 'plain';
  }
}

@SkipEnvelope()
@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { status: 'ok' };
  }
}

describe('Response envelope over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThingsController, ProbeController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves default responses unchanged', async () => {
    const res = await request(app.getHttpServer()).get('/things/one');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'a' });
    expect(res.headers['x-response-envelope']).toBeUndefined();
  });

  it('leaves default errors in the flat shape', async () => {
    const res = await request(app.getHttpServer()).get('/things/missing');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'Thing not found' });
    expect(res.body).not.toHaveProperty('success');
  });

  it('wraps a resource exactly once when opted in', async () => {
    const res = await request(app.getHttpServer())
      .get('/things/one')
      .set('X-Response-Envelope', 'v1');
    expect(res.status).toBe(200);
    expect(res.headers['x-response-envelope']).toBe('v1');
    expect(res.body).toMatchObject({ success: true, data: { id: 'a' } });
    expect(res.body.data).not.toHaveProperty('success');
  });

  it('wraps paginated lists with pagination meta', async () => {
    const res = await request(app.getHttpServer())
      .get('/things/page')
      .set('X-Response-Envelope', 'v1');
    expect(res.body).toMatchObject({
      success: true,
      data: [{ id: 'a' }],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('wraps errors when opted in', async () => {
    const res = await request(app.getHttpServer())
      .get('/things/missing')
      .set('X-Response-Envelope', 'v1');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { message: 'Thing not found' },
    });
  });

  it('never wraps plain-text or skipped endpoints', async () => {
    const text = await request(app.getHttpServer())
      .get('/things/text')
      .set('X-Response-Envelope', 'v1');
    expect(text.text).toBe('plain');

    const probe = await request(app.getHttpServer())
      .get('/probe')
      .set('X-Response-Envelope', 'v1');
    expect(probe.body).toEqual({ status: 'ok' });
  });
});
