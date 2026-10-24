import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { resetRateLimits } from '../server/rate-limit.js';
import { SITE_SEED } from '../server/seed.js';
import { CLOUD_IMG, CLOUD_PID, PASSWORD, boot, tokenFor } from './helpers.js';

describe('public API', () => {
  it('answers health', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('serves every section in one bootstrap call', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/bootstrap');
    assert.equal(res.status, 200);
    assert.equal(res.body.comics.length, 6);
    assert.equal(res.body.articles.length, 8);
    assert.equal(res.body.movies.length, 8);
    assert.equal(res.body.characters.length, 8);
    assert.equal(res.body.team.length, 5);
    assert.equal(res.body.site.heroTitle, 'DEADVERSE');
    assert.equal(res.headers['cache-control'], 'public, max-age=20, must-revalidate');
  });

  it('keeps the wire shape the frontend already renders', async () => {
    const { app } = await boot();
    const { body } = await request(app).get('/api/bootstrap');
    assert.deepEqual(Object.keys(body.comics[0]).sort(), ['desc_en', 'desc_fa', 'id', 'image', 'publisher', 'title_en', 'title_fa', 'year']);
    assert.equal(typeof body.comics[0].year, 'number');
    assert.equal(typeof body.movies[0].rating, 'number');
    assert.equal(body.articles[0].cat, 'marvel');
    assert.equal(body.characters[0].type, 'hero');
    assert.equal(body.team[0].role_fa, 'سردبیر');
    assert.ok(body.comics[0].desc_fa.length > 10, 'descriptions travel with the record');
  });

  it('falls back to default copy when settings are missing', async () => {
    const { app, repo } = await boot();
    await repo.resetSite();
    const { body } = await request(app).get('/api/bootstrap');
    assert.equal(body.site.heroTitle, SITE_SEED.hero_title);
  });

  it('stores a contact message', async () => {
    const { app, store } = await boot();
    const res = await request(app)
      .post('/api/contact')
      .send({ name: 'زهرا', email: 'Zahra@Example.com', subject: 'سلام', message: 'خسته نباشید' });
    assert.equal(res.status, 201);
    assert.equal(store.messages.length, 1);
    assert.equal(store.messages[0].email, 'zahra@example.com', 'email normalised');
  });

  it('rejects an invalid contact payload with field details', async () => {
    const { app, store } = await boot();
    const res = await request(app).post('/api/contact').send({ name: '', email: 'nope', subject: '', message: 'x' });
    assert.equal(res.status, 400);
    assert.equal(store.messages.length, 0);
    assert.ok(Array.isArray(res.body.error.details));
    assert.ok(res.body.error.details.some((d) => d.field === 'email'));
  });

  it('accepts a newsletter signup once', async () => {
    const { app } = await boot();
    const first = await request(app).post('/api/newsletter').send({ email: 'fan@deadverse.io' });
    const again = await request(app).post('/api/newsletter').send({ email: 'fan@deadverse.io' });
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.already_subscribed, true);
  });

  it('404s unknown routes as JSON', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });
});

describe('admin authentication', () => {
  it('refutes a wrong password and an unknown user', async () => {
    const { app } = await boot();
    const bad = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'wrong' });
    const ghost = await request(app).post('/api/admin/login').send({ username: 'ghost', password: PASSWORD });
    assert.equal(bad.status, 401);
    assert.equal(ghost.status, 401);
    assert.equal(bad.body.message, undefined, 'no stack trace leaked');
  });

  it('issues a token that unlocks the admin endpoints', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    assert.ok(token);
    const session = await request(app).get('/api/admin/session').set('Authorization', `Bearer ${token}`);
    assert.equal(session.status, 200);
    assert.equal(session.body.username, 'admin');
  });

  it('accepts the username in any case', async () => {
    const { app } = await boot();
    const res = await request(app).post('/api/admin/login').send({ username: 'ADMIN', password: PASSWORD });
    assert.equal(res.status, 200);
  });

  it('blocks writes without a token and with a garbage token', async () => {
    const { app } = await boot();
    const anonymous = await request(app).post('/api/admin/comics').send({});
    const garbage = await request(app).get('/api/admin/comics').set('Authorization', 'Bearer not.a.jwt');
    assert.equal(anonymous.status, 401);
    assert.equal(garbage.status, 401);
  });

  it('invalidates every older token after a password change', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const changed = await request(app)
      .post('/api/admin/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: PASSWORD, new_password: 'Brand-New-Password-42' });
    assert.equal(changed.status, 200);

    const reused = await request(app).get('/api/admin/comics').set('Authorization', `Bearer ${token}`);
    const oldLogin = await request(app).post('/api/admin/login').send({ username: 'admin', password: PASSWORD });
    const newLogin = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'Brand-New-Password-42' });
    assert.equal(reused.status, 401, 'old token is dead');
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 200);
  });

  it('refuses a weak new password and a wrong current one', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const weak = await request(app)
      .post('/api/admin/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: PASSWORD, new_password: 'short' });
    const wrong = await request(app)
      .post('/api/admin/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'nope-nope-nope', new_password: 'Long-Enough-Password-1' });
    assert.equal(weak.status, 400);
    assert.equal(wrong.status, 400);
  });

  it('throttles repeated login attempts', async () => {
    resetRateLimits();
    const { app } = await boot({ env: { useRealLimiter: true } });
    let last;
    for (let i = 0; i < 12; i += 1) {
      last = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'bad' });
    }
    assert.equal(last.status, 429);
    resetRateLimits();
  });
});

describe('collection CRUD', () => {
  const validComic = {
    title_fa: 'تست',
    title_en: 'Test',
    publisher: 'Marvel',
    year: 2024,
    desc_fa: 'توضیح فارسی',
    desc_en: 'English description'
  };

  it('creates, reads, updates and deletes a comic', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(app).post('/api/admin/comics').set(auth).send(validComic);
    assert.equal(created.status, 201);
    assert.equal(created.body.desc_fa, 'توضیح فارسی');

    const list = await request(app).get('/api/admin/comics').set(auth);
    assert.equal(list.body.length, 7);

    const updated = await request(app)
      .put(`/api/admin/comics/${created.body.id}`)
      .set(auth)
      .send({ ...validComic, title_en: 'Test II' });
    assert.equal(updated.body.title_en, 'Test II');

    const removed = await request(app).delete(`/api/admin/comics/${created.body.id}`).set(auth);
    assert.equal(removed.status, 200);
    const after = await request(app).get('/api/admin/comics').set(auth);
    assert.equal(after.body.length, 6);
  });

  it('rejects missing required fields and unknown enums', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const missing = await request(app).post('/api/admin/comics').set('Authorization', `Bearer ${token}`).send({ title_en: 'x' });
    const badPublisher = await request(app)
      .post('/api/admin/comics')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validComic, publisher: 'Dark Horse' });
    const badYear = await request(app)
      .post('/api/admin/comics')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validComic, year: 1200 });
    assert.equal(missing.status, 400);
    assert.equal(badPublisher.status, 400);
    assert.equal(badYear.status, 400);
    assert.equal(missing.body.error.details[0].field, 'title_fa');
  });

  it('refuses non-HTTPS image urls', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const dataUri = await request(app)
      .post('/api/admin/comics')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validComic, image: 'data:image/png;base64,AAAA' });
    const jsUri = await request(app)
      .post('/api/admin/comics')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validComic, image: 'javascript:alert(1)' });
    assert.equal(dataUri.status, 400);
    assert.equal(jsUri.status, 400);
  });

  it('round-trips the article, movie, character and team shapes', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };

    const article = await request(app)
      .post('/api/admin/articles')
      .set(auth)
      .send({
        title_fa: 'ع', title_en: 't', cat: 'news', date_fa: 'مهر ۱۴۰۴', date_en: 'Oct 2026',
        desc_fa: 'a', desc_en: 'b', coverImage: CLOUD_IMG, coverImagePublicId: CLOUD_PID
      });
    assert.equal(article.status, 201);
    assert.equal(article.body.cat, 'news');
    assert.equal(article.body.coverImage, CLOUD_IMG);

    const movie = await request(app)
      .post('/api/admin/movies')
      .set(auth)
      .send({ name_fa: 'ف', name_en: 'm', universe: 'DC', year: 2020, rating: 7.5 });
    assert.equal(movie.status, 201);
    assert.equal(movie.body.rating, 7.5);

    const character = await request(app)
      .post('/api/admin/characters')
      .set(auth)
      .send({ name_fa: 'ش', name_en: 'c', universe: 'Marvel', type: 'villain' });
    assert.equal(character.status, 201);
    assert.equal(character.body.type, 'villain');

    const member = await request(app)
      .post('/api/admin/team')
      .set(auth)
      .send({ name_fa: 'ا', name_en: 'a', role_fa: 'نویسنده', role_en: 'Writer', initials: 'AW' });
    assert.equal(member.status, 201, 'team add works (was broken against localStorage)');
    const teamList = await request(app).get('/api/admin/team').set(auth);
    assert.equal(teamList.body.length, 6);
    const edited = await request(app).put(`/api/admin/team/${member.body.id}`).set(auth)
      .send({ name_fa: 'ا', name_en: 'a', role_fa: 'سردبیر', role_en: 'Editor', initials: 'AW' });
    assert.equal(edited.body.role_fa, 'سردبیر');
    const deleted = await request(app).delete(`/api/admin/team/${member.body.id}`).set(auth);
    assert.equal(deleted.status, 200);
    const afterDelete = await request(app).get('/api/admin/team').set(auth);
    assert.equal(afterDelete.body.length, 5, 'team delete really removes');
  });

  it('requires an English date for articles', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await request(app)
      .post('/api/admin/articles')
      .set('Authorization', `Bearer ${token}`)
      .send({ title_fa: 'ع', title_en: 't', cat: 'news', date_fa: 'مهر', desc_fa: '', desc_en: '' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.field === 'date_en'));
  });

  it('404s when editing something already deleted', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await request(app)
      .put('/api/admin/comics/cm_missing')
      .set('Authorization', `Bearer ${token}`)
      .send(validComic);
    assert.equal(res.status, 404);
  });
});

describe('Cloudinary assets', () => {
  it('signs a browser upload', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await request(app).post('/api/admin/upload-sign').set('Authorization', `Bearer ${token}`).send({ key: 'comics' });
    assert.equal(res.status, 200);
    assert.equal(res.body.cloud_name, 'demo');
    assert.equal(res.body.folder, 'deadverse/comics');
    assert.match(res.body.signature, /^[0-9a-f]{40}$/);
    assert.equal(res.body.upload_endpoint, 'https://api.cloudinary.com/v1_1/demo/image/upload');
  });

  it('reports 503 when Cloudinary is not configured', async () => {
    const { app } = await boot({ env: { cloudinary: { cloudName: '', apiKey: '', apiSecret: '', folder: 'deadverse' } } });
    const token = await tokenFor(app);
    const res = await request(app).post('/api/admin/upload-sign').set('Authorization', `Bearer ${token}`).send({ key: 'comics' });
    assert.equal(res.status, 503);
  });

  it('destroys the replaced picture only', async () => {
    const { app, released } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(app)
      .post('/api/admin/comics')
      .set(auth)
      .send({ title_fa: 'ت', title_en: 't', publisher: 'DC', year: 2000, image: CLOUD_IMG, imagePublicId: CLOUD_PID });

    const replaced = await request(app)
      .put(`/api/admin/comics/${created.body.id}`)
      .set(auth)
      .send({ ...created.body, image: 'https://res.cloudinary.com/demo/image/upload/deadverse/comics/two.jpg', imagePublicId: 'deadverse/comics/two' });
    assert.equal(replaced.status, 200);
    assert.deepEqual(released, [CLOUD_PID], 'old asset released once');

    released.length = 0;
    const editedNoUpload = await request(app)
      .put(`/api/admin/comics/${created.body.id}`)
      .set(auth)
      .send({ ...replaced.body, imagePublicId: '' });
    assert.equal(editedNoUpload.status, 200);
    assert.deepEqual(released, [], 're-typing the title must not delete the cover');

    released.length = 0;
    await request(app).delete(`/api/admin/comics/${created.body.id}`).set(auth);
    assert.deepEqual(released, ['deadverse/comics/two'], 'deleting the record deletes the asset');
  });
});

describe('site settings, inbox and backup', () => {
  it('saves settings and shows them on the public bootstrap', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const current = await request(app).get('/api/admin/site').set('Authorization', `Bearer ${token}`);
    assert.equal(current.body.heroTitle, 'DEADVERSE');

    const saved = await request(app)
      .put('/api/admin/site')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...current.body, heroTitle: 'DEADVERSE X', heroSub_fa: 'زیرعنوان تازه' });
    assert.equal(saved.body.heroTitle, 'DEADVERSE X');

    const bootstrap = await request(app).get('/api/bootstrap');
    assert.equal(bootstrap.body.site.heroTitle, 'DEADVERSE X');
    assert.equal(bootstrap.body.site.heroSub_fa, 'زیرعنوان تازه');
  });

  it('lists, marks read and deletes messages', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/contact').send({ name: 'a', email: 'a@b.co', subject: 's', message: 'm' });

    const list = await request(app).get('/api/admin/messages').set(auth);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].message, 'm');

    await request(app).patch(`/api/admin/messages/${list.body[0].id}`).set(auth).send({ is_read: true });
    const stats = await request(app).get('/api/admin/stats').set(auth);
    assert.equal(stats.body.unread, 0);

    const cleared = await request(app).delete('/api/admin/messages').set(auth);
    assert.equal(cleared.body.deleted, 1);
  });

  it('exports and re-imports without losing content', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };

    const backup = await request(app).get('/api/admin/export').set(auth);
    assert.equal(backup.body.data.comics.length, 6);

    await request(app).post('/api/admin/comics').set(auth).send({
      title_fa: 'حذف‌شدنی', title_en: 'doomed', publisher: 'Marvel', year: 2020
    });
    const imported = await request(app).post('/api/admin/import').set(auth).send(backup.body);
    assert.equal(imported.body.imported.comics, 6);

    const comics = await request(app).get('/api/admin/comics').set(auth);
    assert.equal(comics.body.length, 6);
    assert.equal(store.messages.length, 0);
  });

  it('drops legacy base64 pictures during import but says so', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const payload = {
      data: {
        comics: [{ title_fa: 'ا', title_en: 'a', publisher: 'DC', year: 1999, image: 'data:image/png;base64,Zm9v' }],
        articles: [], movies: [], characters: [], team: [], messages: []
      }
    };
    const res = await request(app).post('/api/admin/import').set('Authorization', `Bearer ${token}`).send(payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.imported.comics, 1);
    assert.ok(res.body.warnings.length >= 1);
    const comics = await request(app).get('/api/admin/comics').set('Authorization', `Bearer ${token}`);
    assert.equal(comics.body[0].image, '');
  });

  it('rejects a malformed backup file', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await request(app).post('/api/admin/import').set('Authorization', `Bearer ${token}`).send({ nope: 1 });
    assert.equal(res.status, 400);
  });

  it('resets everything back to the shipped defaults', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/admin/comics').set(auth).send({
      title_fa: 'زائد', title_en: 'junk', publisher: 'Marvel', year: 2021
    });
    await request(app).post('/api/contact').send({ name: 'a', email: 'a@b.co', subject: 's', message: 'm' });

    const reset = await request(app).post('/api/admin/reset').set(auth);
    assert.equal(reset.status, 200);
    const comics = await request(app).get('/api/admin/comics').set(auth);
    assert.equal(comics.body.length, 6);
    assert.equal(store.messages.length, 0);
    assert.equal(comics.body[0].title_en, 'The Dark Knight Returns');
  });
});

describe('transport safety', () => {
  it('answers the allowed origin and stays silent for others', async () => {
    const allowed = await boot({ env: { allowedOrigins: ['https://nitson-games.github.io'] } });
    const ok = await request(allowed.app).get('/api/bootstrap').set('Origin', 'https://nitson-games.github.io');
    assert.equal(ok.headers['access-control-allow-origin'], 'https://nitson-games.github.io');

    const blocked = await request(allowed.app).get('/api/bootstrap').set('Origin', 'https://evil.example');
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
    assert.equal(blocked.status, 200, 'data still returns, the browser is what refuses cross-origin');
  });

  it('sends hardening headers and no x-powered-by', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('rejects oversized request bodies', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await request(app)
      .post('/api/admin/comics')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ title_fa: 'x'.repeat(700_000) }));
    assert.equal(res.status, 413);
  });

  it('refuses a body that is not JSON', async () => {
    const { app } = await boot();
    const res = await request(app)
      .post('/api/contact')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_json');
  });
});
