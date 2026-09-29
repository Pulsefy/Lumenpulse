import { INestApplication } from '@nestjs/common';
import { bearer, createApp, createUser, http } from './support/app';

describe('Review history (db e2e)', () => {
  let app: INestApplication;
  let user: { token: string };
  let admin: { token: string };

  beforeAll(async () => {
    app = await createApp();
    user = await createUser(app, 'rev-user');
    admin = await createUser(app, 'rev-admin', 'admin');
  });
  afterAll(async () => {
    await app.close();
  });

  const comment = (token: string, extra: object = {}) =>
    http(app)
      .post('/review-history/comments')
      .set(bearer(token))
      .send({
        targetId: 'proj-1',
        targetType: 'project',
        content: 'looks good',
        ...extra,
      });

  it('requires authentication', async () => {
    await http(app).post('/review-history/comments').send({}).expect(401);
  });

  it('stores a public comment and reads it back by id and by target', async () => {
    const res = await comment(user.token).expect(201);
    const id = (res.body as { id: string }).id;
    await http(app)
      .get(`/review-history/comments/${id}`)
      .set(bearer(user.token))
      .expect(200);
    const byTarget = await http(app)
      .get('/review-history/target/project/proj-1')
      .set(bearer(user.token))
      .expect(200);
    expect(JSON.stringify(byTarget.body)).toContain('looks good');
  });

  it('keeps internal comments admin-only (create and read)', async () => {
    await comment(user.token, { visibility: 'internal' }).expect(403);
    const res = await comment(admin.token, {
      visibility: 'internal',
      content: 'secret',
    }).expect(201);
    const id = (res.body as { id: string }).id;
    await http(app)
      .get(`/review-history/comments/${id}`)
      .set(bearer(user.token))
      .expect(403);
    await http(app)
      .get(`/review-history/comments/${id}`)
      .set(bearer(admin.token))
      .expect(200);
  });

  it('lets only admins record decisions', async () => {
    const body = {
      targetId: 'proj-1',
      targetType: 'project',
      decisionType: 'approved',
      rationale: 'ok',
    };
    await http(app)
      .post('/review-history/decisions')
      .set(bearer(user.token))
      .send(body)
      .expect(403);
    await http(app)
      .post('/review-history/decisions')
      .set(bearer(admin.token))
      .send(body)
      .expect(201);
  });
});
