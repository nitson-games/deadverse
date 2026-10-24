import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { ALL_PERMISSIONS } from '../server/permissions.js';
import { PASSWORD, boot, tokenFor } from './helpers.js';

const staffAdmins = () => [
  { username: 'admin', password: PASSWORD },
  { username: 'editor', password: PASSWORD, permissions: ['content'] },
  { username: 'postman', password: PASSWORD, permissions: ['messages', 'newsletter'] },
  { username: 'watcher', password: PASSWORD, permissions: [] }
];

const staffBoot = () => boot({ admins: staffAdmins() });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('admin staff and permissions', () => {
  it('lists accounts with the permission catalogue and never a hash', async () => {
    const { app } = await staffBoot();
    const res = await request(app).get('/api/admin/admins').set(auth(await tokenFor(app)));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((a) => a.username), ['admin', 'editor', 'postman', 'watcher']);
    assert.deepEqual(res.body.items[1].permissions, ['content']);
    assert.equal(res.body.items[0].is_active, true);
    assert.ok(res.body.permissions.some((p) => p.key === 'admins' && p.label.length > 3));
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('password_hash'), 'hash must never leave the API');
    assert.ok(!raw.includes(PASSWORD), 'password must never leave the API');
  });

  it('refuses anyone without the admins permission', async () => {
    const { app } = await staffBoot();
    for (const username of ['editor', 'postman', 'watcher']) {
      const token = await tokenFor(app, username);
      const list = await request(app).get('/api/admin/admins').set(auth(token));
      assert.equal(list.status, 403, username);
      assert.equal(list.body.error.code, 'forbidden', username);
      const create = await request(app)
        .post('/api/admin/admins')
        .set(auth(token))
        .send({ username: 'sneaky', display_name: 'Sneaky', password: PASSWORD, permissions: ['admins'] });
      assert.equal(create.status, 403, username);
    }
  });

  it('scopes every admin area to its own permission', async () => {
    const { app } = await staffBoot();
    const editor = await tokenFor(app, 'editor');
    const postman = await tokenFor(app, 'postman');
    const watcher = await tokenFor(app, 'watcher');

    assert.equal((await request(app).get('/api/admin/comics').set(auth(editor))).status, 200);
    assert.equal((await request(app).put('/api/admin/site').set(auth(editor)).send({})).status, 403);
    assert.equal((await request(app).get('/api/admin/export').set(auth(editor))).status, 403);
    assert.equal((await request(app).get('/api/admin/messages').set(auth(postman))).status, 200);
    assert.equal((await request(app).delete('/api/admin/messages').set(auth(postman))).status, 200);
    assert.equal((await request(app).get('/api/admin/subscribers').set(auth(postman))).status, 200);
    assert.equal((await request(app).get('/api/admin/articles').set(auth(postman))).status, 403);
    assert.equal((await request(app).get('/api/admin/stats').set(auth(watcher))).status, 200);
    assert.equal((await request(app).get('/api/admin/site').set(auth(watcher))).status, 403);
    assert.equal((await request(app).post('/api/admin/upload-sign').set(auth(watcher)).send({})).status, 403);
  });

  it('creates an account that can log in with only its own permissions', async () => {
    const { app, store } = await staffBoot();
    const created = await request(app)
      .post('/api/admin/admins')
      .set(auth(await tokenFor(app)))
      .send({ username: 'Site.Editor', display_name: 'الناز', password: PASSWORD, permissions: ['site', 'content'] });
    assert.equal(created.status, 201);
    assert.equal(created.body.username, 'site.editor', 'username is normalised');
    assert.deepEqual(created.body.permissions, ['content', 'site']);
    assert.equal(store.admins.length, 5);

    const session = await request(app).post('/api/admin/login').send({ username: 'site.editor', password: PASSWORD });
    assert.equal(session.status, 200);
    assert.deepEqual(session.body.permissions, ['content', 'site']);
    const bearer = auth(session.body.token);
    assert.equal((await request(app).get('/api/admin/site').set(bearer)).status, 200);
    assert.equal((await request(app).get('/api/admin/admins').set(bearer)).status, 403);
  });

  it('validates the new account payload', async () => {
    const { app } = await staffBoot();
    const token = auth(await tokenFor(app));
    const bad = await request(app)
      .post('/api/admin/admins')
      .set(token)
      .send({ username: 'A', display_name: '', password: 'short', permissions: ['admins', 'made_up'] });
    assert.equal(bad.status, 400);
    const fields = bad.body.error.details.map((d) => d.field);
    assert.ok(fields.includes('username') && fields.includes('display_name') && fields.includes('password'));

    const clash = await request(app)
      .post('/api/admin/admins')
      .set(token)
      .send({ username: 'editor', display_name: 'تکراری', password: PASSWORD, permissions: [] });
    assert.equal(clash.status, 409);
  });

  it('edits permissions and logs that account out of every session', async () => {
    const { app, store } = await staffBoot();
    const token = await tokenFor(app);
    const target = store.admins.find((a) => a.username === 'postman');
    const theirToken = auth(await tokenFor(app, 'postman'));

    const updated = await request(app)
      .put(`/api/admin/admins/${target.id}`)
      .set(auth(token))
      .send({ display_name: 'پستچی', permissions: ['messages'], is_active: true });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.permissions, ['messages']);
    assert.equal(updated.body.display_name, 'پستچی');

    assert.equal((await request(app).get('/api/admin/messages').set(theirToken)).status, 401, 'old token is dead');
    const fresh = auth(await tokenFor(app, 'postman'));
    assert.equal((await request(app).get('/api/admin/messages').set(fresh)).status, 200);
    assert.equal((await request(app).get('/api/admin/subscribers').set(fresh)).status, 403);
  });

  it('deactivates an account without deleting it', async () => {
    const { app, store } = await staffBoot();
    const target = store.admins.find((a) => a.username === 'watcher');
    const off = await request(app)
      .put(`/api/admin/admins/${target.id}`)
      .set(auth(await tokenFor(app)))
      .send({ display_name: 'بیننده', permissions: [], is_active: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.is_active, false);
    assert.equal((await request(app).post('/api/admin/login').send({ username: 'watcher', password: PASSWORD })).status, 401);
    assert.equal(store.admins.some((a) => a.username === 'watcher'), true, 'row is kept');
  });

  it('refuses self-service changes that could lock the panel', async () => {
    const { app, store } = await staffBoot();
    const token = await tokenFor(app);
    const me = store.admins.find((a) => a.username === 'admin');
    const put = (body) => request(app).put(`/api/admin/admins/${me.id}`).set(auth(token)).send(body);

    assert.equal((await put({ display_name: 'Admin', permissions: ['content'], is_active: true })).status, 400);
    assert.equal((await put({ display_name: 'Admin', permissions: ALL_PERMISSIONS, is_active: false })).status, 400);
    assert.equal((await request(app).delete(`/api/admin/admins/${me.id}`).set(auth(token))).status, 400);

    const rename = await put({ display_name: 'مدیر کل', permissions: ALL_PERMISSIONS, is_active: true });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.display_name, 'مدیر کل');
    assert.equal((await request(app).get('/api/admin/stats').set(auth(token))).status, 200, 'own profile edit keeps the session');
  });

  it('resets another account password but never your own', async () => {
    const { app, store } = await staffBoot();
    const token = auth(await tokenFor(app));
    const target = store.admins.find((a) => a.username === 'editor');
    const me = store.admins.find((a) => a.username === 'admin');

    const ok = await request(app)
      .post(`/api/admin/admins/${target.id}/password`)
      .set(token)
      .send({ password: 'Fresh-Password-42' });
    assert.equal(ok.status, 200);
    assert.equal((await request(app).post('/api/admin/login').send({ username: 'editor', password: 'Fresh-Password-42' })).status, 200);

    assert.equal((await request(app).post(`/api/admin/admins/${target.id}/password`).set(token).send({ password: 'short' })).status, 400);
    assert.equal((await request(app).post(`/api/admin/admins/${me.id}/password`).set(token).send({ password: 'Fresh-Password-42' })).status, 400);
  });

  it('deletes an account and blocks an unknown id', async () => {
    const { app, store } = await staffBoot();
    const token = auth(await tokenFor(app));
    const target = store.admins.find((a) => a.username === 'editor');
    assert.equal((await request(app).delete(`/api/admin/admins/${target.id}`).set(token)).status, 200);
    assert.equal(store.admins.some((a) => a.username === 'editor'), false);
    assert.equal((await request(app).post('/api/admin/login').send({ username: 'editor', password: PASSWORD })).status, 401);
    assert.equal((await request(app).delete('/api/admin/admins/ad_nobody').set(token)).status, 404);
  });

  it('reports the signed-in permissions through the session endpoint', async () => {
    const { app } = await staffBoot();
    const res = await request(app).get('/api/admin/session').set(auth(await tokenFor(app, 'postman')));
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'postman');
    assert.deepEqual(res.body.permissions, ['messages', 'newsletter']);
  });
});
