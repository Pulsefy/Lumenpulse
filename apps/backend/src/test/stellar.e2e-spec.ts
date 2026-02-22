import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';

describe('StellarController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/stellar/assets?asset_code=USDC (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/stellar/assets?asset_code=USDC');
    expect(res.status).toBe(200);
    expect(res.body.assets).toBeInstanceOf(Array);
  });

  it('/stellar/assets (GET) without params should fail', async () => {
    const res = await request(app.getHttpServer()).get('/stellar/assets');
    expect(res.status).toBe(400);
  });
});
