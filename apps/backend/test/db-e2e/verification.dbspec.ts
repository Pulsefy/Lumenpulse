import { INestApplication } from '@nestjs/common';
import { bearer, createApp, createUser, http } from './support/app';

describe('Verification requests (db e2e)', () => {
  let app: INestApplication;
  let user: { token: string };
  let reviewer: { token: string };
  let other: { token: string };

  beforeAll(async () => {
    app = await createApp();
    user = await createUser(app, 'ver-user');
    other = await createUser(app, 'ver-other');
    reviewer = await createUser(app, 'ver-rev', 'reviewer');
  });
  afterAll(async () => {
    await app.close();
  });

  const create = (token: string, targetId: string) =>
    http(app).post('/verification-requests').set(bearer(token)).send({
      targetType: 'PROJECT',
      targetId,
      evidence: 'https://example.com/proof',
    });

  it('creates a request persisted as SUBMITTED and lists it under /mine', async () => {
    const res = await create(user.token, 'p-1').expect(201);
    expect((res.body as { status: string }).status).toBe('SUBMITTED');
    const mine = await http(app)
      .get('/verification-requests/mine')
      .set(bearer(user.token))
      .expect(200);
    expect(JSON.stringify(mine.body)).toContain('p-1');
  });

  it('rejects invalid payloads and unauthenticated calls', async () => {
    await http(app).post('/verification-requests').send({}).expect(401);
    await http(app)
      .post('/verification-requests')
      .set(bearer(user.token))
      .send({ targetType: 'NOPE', targetId: 'x', evidence: 'e' })
      .expect(400);
  });

  it('only reviewers/admins can list all or change status', async () => {
    const res = await create(user.token, 'p-2').expect(201);
    const id = (res.body as { id: string }).id;
    await http(app)
      .get('/verification-requests')
      .set(bearer(user.token))
      .expect(403);
    await http(app)
      .patch(`/verification-requests/${id}/status`)
      .set(bearer(user.token))
      .send({ status: 'APPROVED' })
      .expect(403);
    await http(app)
      .get('/verification-requests')
      .set(bearer(reviewer.token))
      .expect(200);
  });

  it('walks SUBMITTED -> IN_REVIEW -> APPROVED and blocks cancelling a decided request', async () => {
    const res = await create(other.token, 'p-3').expect(201);
    const id = (res.body as { id: string }).id;
    const patch = (status: string) =>
      http(app)
        .patch(`/verification-requests/${id}/status`)
        .set(bearer(reviewer.token))
        .send({ status, reviewNote: 'e2e' });
    await patch('IN_REVIEW').expect(200);
    const approved = await patch('APPROVED').expect(200);
    expect((approved.body as { status: string }).status).toBe('APPROVED');
    const cancel = await http(app)
      .post(`/verification-requests/${id}/cancel`)
      .set(bearer(other.token));
    expect(cancel.status).toBeGreaterThanOrEqual(400);
    expect(cancel.status).toBeLessThan(500);
  });
});
