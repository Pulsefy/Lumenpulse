import { INestApplication } from '@nestjs/common';
import { bearer, createApp, createUser, http } from './support/app';

const project = (targetAmount: string) => ({
  owner: 'GOWNERE2E',
  name: 'E2E Project',
  description: 'e2e',
  targetAmount,
  tokenAddress: 'CTOKENE2E',
});

describe('Crowdfund contribute (db e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createApp();
    token = (await createUser(app, 'contrib')).token;
  });
  afterAll(async () => {
    await app.close();
  });

  it('requires auth to create a project', async () => {
    await http(app)
      .post('/crowdfund/projects')
      .send(project('100'))
      .expect(401);
  });

  it('creates a project, accepts a contribution and reflects it', async () => {
    const created = await http(app)
      .post('/crowdfund/projects')
      .set(bearer(token))
      .send(project('1000'))
      .expect(201);
    const id = (created.body as { id: number }).id;

    const res = await http(app)
      .post('/crowdfund/contribute')
      .send({ projectId: id, amount: '10', senderPublicKey: 'GSENDERE2E' })
      .expect(201);
    expect(
      (res.body as { transactionHash?: string }).transactionHash,
    ).toBeTruthy();

    const contributors = await http(app)
      .get(`/crowdfund/projects/${id}/contributors`)
      .expect(200);
    expect(JSON.stringify(contributors.body)).toContain('GSENDERE2E');
  });

  it('validates input and rejects unknown projects', async () => {
    await http(app)
      .post('/crowdfund/contribute')
      .send({ projectId: 0, amount: '10', senderPublicKey: 'G' })
      .expect(400);
    await http(app)
      .post('/crowdfund/contribute')
      .send({ projectId: 999999, amount: '10', senderPublicKey: 'G' })
      .expect(404);
  });

  it('closes a project to new contributions once its goal is reached', async () => {
    const created = await http(app)
      .post('/crowdfund/projects')
      .set(bearer(token))
      .send(project('5'))
      .expect(201);
    const id = (created.body as { id: number }).id;
    const body = { projectId: id, amount: '5', senderPublicKey: 'GFUNDER' };
    await http(app).post('/crowdfund/contribute').send(body).expect(201);
    await http(app).post('/crowdfund/contribute').send(body).expect(400);
  });
});
