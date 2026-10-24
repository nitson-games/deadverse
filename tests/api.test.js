import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { resetRateLimits } from '../server/rate-limit.js';
import { SITE_SEED } from '../server/seed.js';
import { EXTERNAL_IMG, EXTERNAL_PID, PASSWORD, PNG_PIXEL, boot, tokenFor } from './helpers.js';
import { MAX_MEDIA_BYTES } from '../server/media.js';

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
        desc_fa: 'a', desc_en: 'b', coverImage: EXTERNAL_IMG, coverImagePublicId: EXTERNAL_PID
      });
    assert.equal(article.status, 201);
    assert.equal(article.body.cat, 'news');
    assert.equal(article.body.coverImage, EXTERNAL_IMG);

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

describe('media stored in the database', () => {
  const upload = (app, token, bytes, type = 'image/png') =>
    request(app)
      .post('/api/admin/media')
      .set('Authorization', `Bearer ${token}`)
      .type(type)
      .send(bytes);

  it('stores the bytes and serves them back immutable', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const res = await upload(app, token, PNG_PIXEL);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.id, /^md_[0-9a-z]+$/);
    assert.equal(res.body.url, `/api/media/${res.body.id}`);
    assert.equal(res.body.bytes, PNG_PIXEL.length);
    assert.ok(store.media.has(res.body.id), 'bytes never reached storage');

    const served = await request(app).get(`/api/media/${res.body.id}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.match(served.headers['cache-control'], /public, max-age=31536000, immutable/);
    assert.match(served.headers['vercel-cdn-cache-control'], /public, s-maxage=\d+/, 'edge copy must expire so deleted bytes stop being served');
    assert.deepEqual(served.body, PNG_PIXEL);

    const cached = await request(app).get(`/api/media/${res.body.id}`).set('If-None-Match', served.headers.etag);
    assert.equal(cached.status, 304);
  });

  it('takes the type from the file bytes, not the declared content-type', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const res = await upload(app, token, PNG_PIXEL, 'image/jpeg');
    assert.equal(res.status, 201);
    assert.equal(res.body.contentType, 'image/png');
    const served = await request(app).get(`/api/media/${res.body.id}`);
    assert.equal(served.headers['content-type'], 'image/png');
  });

  it('rejects anything that is not a picture', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const html = await upload(app, token, Buffer.from('<html><script>alert(1)</script></html>'));
    assert.equal(html.status, 400);
    const empty = await upload(app, token, Buffer.alloc(0));
    assert.equal(empty.status, 400);
    const oversized = await upload(app, token, Buffer.alloc(MAX_MEDIA_BYTES + 1));
    assert.equal(oversized.status, 413);
    assert.equal(store.media.size, 0, 'a rejected upload must not leave bytes behind');
  });

  it('needs a signed-in account with the content permission', async () => {
    const { app } = await boot();
    assert.equal((await request(app).post('/api/admin/media').type('image/png').send(PNG_PIXEL)).status, 401);
    assert.equal((await request(app).get('/api/media/md_doesnotexist')).status, 404);
    assert.equal((await request(app).get('/api/media/md_NOT_VALID')).status, 404);
  });

  it('frees the old bytes when a picture is replaced, not when text is edited', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };
    const first = await upload(app, token, PNG_PIXEL);
    const second = await upload(app, token, PNG_PIXEL);

    const created = await request(app)
      .post('/api/admin/comics')
      .set(auth)
      .send({
        title_fa: 'ت', title_en: 't', publisher: 'DC', year: 2000,
        image: first.body.url, imagePublicId: first.body.id
      });
    assert.equal(created.status, 201);

    const replaced = await request(app)
      .put(`/api/admin/comics/${created.body.id}`)
      .set(auth)
      .send({ ...created.body, image: second.body.url, imagePublicId: second.body.id });
    assert.equal(replaced.status, 200);
    assert.ok(!store.media.has(first.body.id), 'the replaced picture still holds bytes');
    assert.ok(store.media.has(second.body.id));

    const textOnly = await request(app)
      .put(`/api/admin/comics/${created.body.id}`)
      .set(auth)
      .send({ ...replaced.body, title_fa: 'ت ویرایش' });
    assert.equal(textOnly.status, 200);
    assert.ok(store.media.has(second.body.id), 're-typing the title must not delete the cover');
    assert.equal(textOnly.body.image, second.body.url);

    await request(app).delete(`/api/admin/comics/${created.body.id}`).set(auth);
    assert.ok(!store.media.has(second.body.id), 'deleting the record must free the picture');
  });

  it('keeps a /api/media reference through export and import', async () => {
    const { app, store } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };
    const uploaded = await upload(app, token, PNG_PIXEL);
    await request(app)
      .post('/api/admin/comics')
      .set(auth)
      .send({ title_fa: 'ت', title_en: 't', publisher: 'DC', year: 2000, image: uploaded.body.url, imagePublicId: uploaded.body.id });

    const backup = await request(app).get('/api/admin/export').set(auth);
    const restored = await request(app).post('/api/admin/import').set(auth).send(backup.body);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual(restored.body.warnings, []);

    const comics = await request(app).get('/api/bootstrap');
    const withImage = comics.body.comics.find((c) => c.image === uploaded.body.url);
    assert.ok(withImage, 'the imported row lost its picture');
    const served = await request(app).get(`/api/media/${uploaded.body.id}`);
    assert.equal(served.status, 200, 'imported reference does not resolve');
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

  it('keeps footer social links as plain https URLs', async () => {
    const { app } = await boot();
    const token = await tokenFor(app);
    const auth = { Authorization: `Bearer ${token}` };
    const current = await request(app).get('/api/admin/site').set(auth);
    assert.equal(current.body.socialX, '');

    const saved = await request(app)
      .put('/api/admin/site')
      .set(auth)
      .send({ ...current.body, socialX: 'https://x.com/deadverse' });
    assert.equal(saved.body.socialX, 'https://x.com/deadverse');
    const bootstrap = await request(app).get('/api/bootstrap');
    assert.equal(bootstrap.body.site.socialX, 'https://x.com/deadverse');

    const bad = await request(app)
      .put('/api/admin/site')
      .set(auth)
      .send({ ...current.body, socialX: 'javascript:alert(1)' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.details.some((d) => d.field === 'socialX'));
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
