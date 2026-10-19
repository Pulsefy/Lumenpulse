import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { setupApp } from '../src/bootstrap/app.setup';
import { MAX_REQUEST_BODY_SIZE_BYTES } from '../src/common/constants/request.constants';
import { ErrorCode } from '../src/common/enums/error-code.enum';

describe('Request body size limit (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a JSON body at the configured byte limit', async () => {
    const body = JSON.stringify({
      payload: 'x'.repeat(MAX_REQUEST_BODY_SIZE_BYTES - 14),
    });
    expect(Buffer.byteLength(body)).toBe(MAX_REQUEST_BODY_SIZE_BYTES);

    await request(app.getHttpServer())
      .post('/payload-limit-check')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(404);
  });

  it('returns a clear 413 error for a JSON body over the configured limit', async () => {
    const body = JSON.stringify({
      payload: 'x'.repeat(MAX_REQUEST_BODY_SIZE_BYTES - 13),
    });
    expect(Buffer.byteLength(body)).toBe(MAX_REQUEST_BODY_SIZE_BYTES + 1);

    const response = await request(app.getHttpServer())
      .post('/payload-limit-check')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(413);

    expect(response.body).toMatchObject({
      code: ErrorCode.SYS_PAYLOAD_TOO_LARGE,
      message: `Request body exceeds the ${MAX_REQUEST_BODY_SIZE_BYTES}-byte limit`,
    });
  });
});
