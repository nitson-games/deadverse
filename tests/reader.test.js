import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import {
  MEMBER_PASSWORD,
  PASSWORD,
  boot,
  memberTokenFor,
  solveQuestion,
  tokenFor,
  withChallenge
} from './helpers.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** A reader account plus the article it is meant to unlock. */
async function readerAndArticle(extraAdmins) {
  const ctx = await boot(extraAdmins ? { admins: extraAdmins } : {});
  const app = ctx.app;
  const admin = await tokenFor(app);
  const article = await request(app)
    .post('/api/admin/articles')
    .set(auth(admin))
    .send({
      title_fa: 'رمز کیهانی',
      title_en: 'Cosmic Cipher',
      cat: 'news',
      date_fa: '۱۴۰۵',
      date_en: '2026',
      desc_fa: 'کوتاه',
      desc_en: 'Short',
      body_fa: 'متن کامل مقاله فقط برای عضوها.',
      body_en: 'The full text is for members only.'
    });
  assert.equal(article.status, 201, JSON.stringify(article.body));
  const reader = await memberTokenFor(app);
  return { ...ctx, admin, article: article.body, reader };
}

describe('reader accounts', () => {
  it('signs a reader up with a session that is not an admin one', async () => {
    const { app, repo } = await boot();
    const res = await request(app)
      .post('/api/member/signup')
      .send(await withChallenge(app, { username: 'Nova.Reader', password: MEMBER_PASSWORD, display_name: 'Nova' }));

    assert.equal(res.status, 201);
    assert.equal(res.body.member.username, 'nova.reader', 'username is normalised, not echoed raw');
    assert.equal(res.body.member.display_name, 'Nova');
    assert.ok(res.body.token, 'the token is what unlocks the gated pages');
    assert.ok(!JSON.stringify(res.body).includes('password'), 'no hash and no password in the answer');
    assert.equal(await repo.countMembers().then((t) => t.total), 1);

    assert.equal((await request(app).get('/api/admin/comics').set(auth(res.body.token))).status, 401);
    assert.equal((await request(app).get('/api/member/session').set(auth(res.body.token))).status, 200);
  });

  it('puts the maths gate in front of account creation too', async () => {
    const { app, repo } = await boot();
    const noAnswer = await request(app)
      .post('/api/member/signup')
      .send({ username: 'botone', password: MEMBER_PASSWORD });
    assert.equal(noAnswer.status, 400);
    assert.match(noAnswer.body.error.message, /سوال|ربات/i);

    const honeypot = await request(app)
      .post('/api/member/signup')
      .send(await withChallenge(app, { username: 'bottwo', password: MEMBER_PASSWORD, website: 'http://spam' }));
    assert.equal(honeypot.status, 201, 'a bot is told it worked');
    assert.equal(honeypot.body.ok, true);
    assert.equal(await repo.countMembers().then((t) => t.total), 0, 'and nothing is stored');
  });

  it('refuses weak passwords, junk usernames and names that are taken', async () => {
    const { app } = await boot();
    await request(app)
      .post('/api/member/signup')
      .send(await withChallenge(app, { username: 'taken.one', password: MEMBER_PASSWORD, email: 'one@deadverse.io' }));

    const cases = [
      { username: 'ab', password: MEMBER_PASSWORD, field: 'username' },
      { username: 'فضا', password: MEMBER_PASSWORD, field: 'username' },
      { username: 'fine.name', password: 'short', field: 'password' },
      { username: 'fine.name', password: MEMBER_PASSWORD, email: 'not-an-email', field: 'email' }
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/member/signup').send(await withChallenge(app, body));
      assert.equal(res.status, 400, JSON.stringify(body));
      const fields = (res.body.error.details || []).map((d) => d.field);
      assert.ok(fields.includes(body.field), `${body.field} should be named: ${JSON.stringify(res.body)}`);
    }

    for (const body of [
      { username: 'taken.one', password: MEMBER_PASSWORD },
      { username: 'another.one', password: MEMBER_PASSWORD, email: 'one@deadverse.io' }
    ]) {
      const res = await request(app).post('/api/member/signup').send(await withChallenge(app, body));
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.body.error.code, 'conflict', JSON.stringify(body));
    }
  });

  it('logs a reader in by username or by email and never on a wrong password', async () => {
    const { app } = await boot();
    await request(app)
      .post('/api/member/signup')
      .send(await withChallenge(app, { username: 'dual.login', password: MEMBER_PASSWORD, email: 'Dual@Deadverse.io' }));

    for (const login of ['dual.login', 'DUAL.LOGIN', 'dual@deadverse.io']) {
      const res = await request(app).post('/api/member/login').send({ login, password: MEMBER_PASSWORD });
      assert.equal(res.status, 200, login);
      assert.equal(res.body.member.username, 'dual.login', login);
    }
    const wrong = await request(app).post('/api/member/login').send({ login: 'dual.login', password: 'Wrong-Pass-1' });
    assert.equal(wrong.status, 401);
    const unknown = await request(app).post('/api/member/login').send({ login: 'ghost', password: MEMBER_PASSWORD });
    assert.equal(unknown.status, 401);
  });

  it('changes a reader password only against the current one, and the old token dies', async () => {
    const { app } = await boot();
    const token = await memberTokenFor(app, 'switcher');
    const bad = await request(app)
      .patch('/api/member/password')
      .set(auth(token))
      .send({ current_password: 'Not-It-12345', new_password: 'Brand-New-Pass-9' });
    assert.equal(bad.status, 400);

    const good = await request(app)
      .patch('/api/member/password')
      .set(auth(token))
      .send({ current_password: MEMBER_PASSWORD, new_password: 'Brand-New-Pass-9' });
    assert.equal(good.status, 200);
    assert.equal((await request(app).get('/api/member/session').set(auth(token))).status, 401, 'token_version moved');
    assert.equal((await request(app).post('/api/member/login').send({ login: 'switcher', password: MEMBER_PASSWORD })).status, 401);
    assert.equal((await request(app).post('/api/member/login').send({ login: 'switcher', password: 'Brand-New-Pass-9' })).status, 200);
  });

  it('lets a reader delete their own account', async () => {
    const { app, repo } = await boot();
    const token = await memberTokenFor(app, 'gone.reader');
    assert.equal((await request(app).delete('/api/member/account').set(auth(token))).status, 200);
    assert.equal((await request(app).get('/api/member/session').set(auth(token))).status, 401);
    assert.equal((await request(app).post('/api/member/login').send({ login: 'gone.reader', password: MEMBER_PASSWORD })).status, 401);
    assert.equal(await repo.countMembers().then((t) => t.total), 0);
    assert.equal((await request(app).delete('/api/member/account')).status, 401);
  });
});

describe('one page per record', () => {
  it('serves comics, movies and characters to anyone', async () => {
    const { app } = await boot();
    const bootstrap = await request(app).get('/api/bootstrap');
    const comic = bootstrap.body.comics[0];
    const movie = bootstrap.body.movies[0];
    const character = bootstrap.body.characters[0];

    for (const [segment, item] of [['comics', comic], ['movies', movie], ['characters', character]]) {
      const res = await request(app).get(`/api/${segment}/${item.slug}`);
      assert.equal(res.status, 200, segment);
      assert.equal(res.body.slug, item.slug, segment);
      assert.match(res.headers['cache-control'], /public/, segment);
    }
  });

  it('keeps article bodies behind a member session and out of the public cache', async () => {
    const { app, article, reader } = await readerAndArticle();
    const secret = 'متن کامل مقاله فقط برای عضوها.';

    const cards = await request(app).get('/api/bootstrap');
    const card = cards.body.articles.find((a) => a.slug === article.slug);
    assert.ok(card, 'the title is still public so the section can be browsed');
    assert.equal(card.body_fa, undefined, 'the body never rides in the cached card list');
    assert.ok(!JSON.stringify(cards.body).includes(secret), 'no gated text in bootstrap');

    const guest = await request(app).get(`/api/articles/${article.slug}`);
    assert.equal(guest.status, 401);
    assert.ok(!JSON.stringify(guest.body).includes(secret), 'a refused page leaks nothing');

    const member = await request(app).get(`/api/articles/${article.slug}`).set(auth(reader));
    assert.equal(member.status, 200);
    assert.equal(member.body.body_fa, secret);
    assert.match(member.headers['cache-control'], /no-store/);

    const admin = await tokenFor(app);
    assert.equal(
      (await request(app).get(`/api/articles/${article.slug}`).set(auth(admin))).status,
      401,
      'an admin token is not a reader token'
    );
  });

  it('takes the slug first, falls back to the id, and 404s a stranger', async () => {
    const { app, article, reader } = await readerAndArticle();
    assert.equal((await request(app).get(`/api/articles/${article.slug}`).set(auth(reader))).status, 200);
    assert.equal((await request(app).get(`/api/articles/${article.id}`).set(auth(reader))).status, 200);
    assert.equal((await request(app).get('/api/articles/never-written').set(auth(reader))).status, 404);
    assert.equal((await request(app).get('/api/comics/never-written')).status, 404);
  });

  it('mints an address from the English title and adds a counter on a clash', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    const base = {
      title_fa: 'مرد عنکبوتی در خانه',
      publisher: 'Marvel',
      year: 2020,
      desc_fa: '',
      desc_en: '',
      image: ''
    };
    const first = await request(app)
      .post('/api/admin/comics')
      .set(auth(admin))
      .send({ ...base, title_en: 'Spider-Man Home' });
    assert.equal(first.status, 201);
    assert.equal(first.body.slug, 'spider-man-home');

    const second = await request(app)
      .post('/api/admin/comics')
      .set(auth(admin))
      .send({ ...base, title_en: 'Spider Man Home' });
    assert.equal(second.status, 201);
    assert.equal(second.body.slug, 'spider-man-home-2', 'a near-duplicate title still gets its own page');

    const renamed = await request(app)
      .put(`/api/admin/comics/${first.body.id}`)
      .set(auth(admin))
      .send({ ...base, title_en: 'Totally Different Name' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.slug, 'spider-man-home', 'an edited title does not break shared links');
  });

  it('accepts a hand-written address and rejects a junky one', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    const good = await request(app)
      .post('/api/admin/characters')
      .set(auth(admin))
      .send({
        name_fa: 'شخصیت', name_en: 'Character', universe: 'DC', type: 'hero',
        desc_fa: '', desc_en: '', image: '', slug: 'my-own-address'
      });
    assert.equal(good.status, 201);
    assert.equal(good.body.slug, 'my-own-address');

    for (const slug of ['Bad Slug', 'فارسی', '-starts-with-dash']) {
      const res = await request(app)
        .post('/api/admin/characters')
        .set(auth(admin))
        .send({
          name_fa: 'شخصیت', name_en: 'Character', universe: 'DC', type: 'hero',
          desc_fa: '', desc_en: '', image: '', slug
        });
      assert.equal(res.status, 400, slug);
      assert.ok((res.body.error.details || []).some((d) => d.field === 'slug'), slug);
    }
  });

  it('gives every kind its own body field for the page', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    const comic = await request(app)
      .post('/api/admin/comics')
      .set(auth(admin))
      .send({
        title_fa: 'کامیک', title_en: 'Long Comic', publisher: 'Marvel', year: 1999,
        desc_fa: 'کوتاه', desc_en: 'Short', image: '',
        body_fa: 'پاراگراف اول\n\nپاراگراف دوم'
      });
    assert.equal(comic.status, 201);
    const page = await request(app).get(`/api/comics/${comic.body.slug}`);
    assert.equal(page.body.body_fa, 'پاراگراف اول\n\nپاراگراف دوم', 'line breaks survive the round trip');
  });
});

describe('watch links', () => {
  it('stores a plain http(s) address and shows it on the movie page', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    const created = await request(app)
      .post('/api/admin/movies')
      .set(auth(admin))
      .send({
        name_fa: 'فیلم', name_en: 'Watchable Film', universe: 'Marvel', year: 2024, rating: 7.5,
        desc_fa: '', desc_en: '', image: '',
        watchUrl: 'https://watch.deadverse.io/watchable-film'
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.watchUrl, 'https://watch.deadverse.io/watchable-film');
    const page = await request(app).get(`/api/movies/${created.body.slug}`);
    assert.equal(page.body.watchUrl, 'https://watch.deadverse.io/watchable-film');
  });

  it('refuses anything that could become a javascript: link', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    for (const watchUrl of ['javascript:alert(1)', 'data:text/html;base64,AA', 'ftp://x.example/a', 'not a url']) {
      const res = await request(app)
        .post('/api/admin/movies')
        .set(auth(admin))
        .send({
          name_fa: 'فیلم', name_en: 'Bad Link Film', universe: 'Marvel', year: 2024, rating: 7.5,
          desc_fa: '', desc_en: '', image: '', watchUrl
        });
      assert.equal(res.status, 400, watchUrl);
      assert.ok((res.body.error.details || []).some((d) => d.field === 'watchUrl'), watchUrl);
    }
    const blank = await request(app)
      .post('/api/admin/movies')
      .set(auth(admin))
      .send({
        name_fa: 'فیلم', name_en: 'No Link Film', universe: 'Marvel', year: 2024, rating: 7.5,
        desc_fa: '', desc_en: '', image: '', watchUrl: ''
      });
    assert.equal(blank.status, 201);
    assert.equal(blank.body.watchUrl, '', 'an empty link hides the button instead of breaking it');
  });
});

describe('admin area for readers', () => {
  it('lists members with totals and never a hash', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    await memberTokenFor(app, 'listed.reader');
    const res = await request(app).get('/api/admin/members').set(auth(admin));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((m) => m.username), ['listed.reader']);
    assert.deepEqual(res.body.totals.total, 1);
    assert.equal(typeof res.body.totals.active, 'number');
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('password_hash') && !raw.includes(MEMBER_PASSWORD), 'reader secrets stay inside the database');
  });

  it('filters the list by username, display name or email', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    await memberTokenFor(app, 'alpha.reader');
    await request(app)
      .post('/api/member/signup')
      .send(await withChallenge(app, { username: 'beta.reader', password: MEMBER_PASSWORD, display_name: 'بتا' }));

    const all = await request(app).get('/api/admin/members').set(auth(admin));
    assert.equal(all.body.items.length, 2);
    const byName = await request(app).get('/api/admin/members?q=alpha').set(auth(admin));
    assert.deepEqual(byName.body.items.map((m) => m.username), ['alpha.reader']);
    const byDisplay = await request(app).get('/api/admin/members?q=بتا').set(auth(admin));
    assert.deepEqual(byDisplay.body.items.map((m) => m.username), ['beta.reader']);
  });

  it('builds an account for a reader who asked by mail, then edits it', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    const created = await request(app)
      .post('/api/admin/members')
      .set(auth(admin))
      .send({ username: 'by.hand', password: MEMBER_PASSWORD, display_name: 'دستی', email: 'Hand@Deadverse.io' });
    assert.equal(created.status, 201);
    assert.equal(created.body.username, 'by.hand');
    assert.equal(created.body.is_active, true);

    assert.equal((await request(app).post('/api/member/login').send({ login: 'by.hand', password: MEMBER_PASSWORD })).status, 200);

    const clash = await request(app)
      .post('/api/admin/members')
      .set(auth(admin))
      .send({ username: 'by.hand', password: MEMBER_PASSWORD });
    assert.equal(clash.status, 409);

    const edited = await request(app)
      .patch(`/api/admin/members/${created.body.id}`)
      .set(auth(admin))
      .send({ display_name: 'دستی ویرایش', email: 'other@deadverse.io', is_active: true });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.display_name, 'دستی ویرایش');

    const reset = await request(app)
      .post(`/api/admin/members/${created.body.id}/password`)
      .set(auth(admin))
      .send({ password: 'Fresh-Reader-99' });
    assert.equal(reset.status, 200);
    assert.equal((await request(app).post('/api/member/login').send({ login: 'by.hand', password: MEMBER_PASSWORD })).status, 401);
    assert.equal((await request(app).post('/api/member/login').send({ login: 'by.hand', password: 'Fresh-Reader-99' })).status, 200);

    assert.equal((await request(app).delete(`/api/admin/members/${created.body.id}`).set(auth(admin))).status, 200);
    assert.equal((await request(app).delete('/api/admin/members/mem_nope').set(auth(admin))).status, 404);
  });

  it('switches an account off in the middle of a read', async () => {
    const { app, article, admin, reader } = await readerAndArticle();
    const me = await request(app).get('/api/member/session').set(auth(reader));
    assert.equal(me.status, 200);

    const off = await request(app)
      .patch(`/api/admin/members/${me.body.member.id}`)
      .set(auth(admin))
      .send({ display_name: 'First Reader', email: '', is_active: false });
    assert.equal(off.status, 200);
    assert.equal((await request(app).get(`/api/articles/${article.slug}`).set(auth(reader))).status, 401);
    assert.equal((await request(app).post('/api/member/login').send({ login: 'reader.one', password: MEMBER_PASSWORD })).status, 401);

    const on = await request(app)
      .patch(`/api/admin/members/${me.body.member.id}`)
      .set(auth(admin))
      .send({ display_name: 'First Reader', email: '', is_active: true });
    assert.equal(on.status, 200);
    const back = await request(app).post('/api/member/login').send({ login: 'reader.one', password: MEMBER_PASSWORD });
    assert.equal(back.status, 200);
    assert.equal((await request(app).get(`/api/articles/${article.slug}`).set(auth(back.body.token))).status, 200);
  });

  it('is a separate permission from the staff list', async () => {
    const { app } = await boot({
      admins: [
        { username: 'admin', password: PASSWORD },
        { username: 'staffonly', password: PASSWORD, permissions: ['admins'] },
        { username: 'membersonly', password: PASSWORD, permissions: ['members'] },
        { username: 'editor', password: PASSWORD, permissions: ['content'] }
      ]
    });
    const staff = await tokenFor(app, 'staffonly');
    const membersOnly = await tokenFor(app, 'membersonly');
    const editor = await tokenFor(app, 'editor');

    assert.equal((await request(app).get('/api/admin/members').set(auth(staff))).status, 403);
    assert.equal((await request(app).get('/api/admin/admins').set(auth(membersOnly))).status, 403);
    assert.equal((await request(app).get('/api/admin/members').set(auth(membersOnly))).status, 200);
    assert.equal((await request(app).get('/api/admin/members').set(auth(editor))).status, 403);
    assert.equal(
      (await request(app).post('/api/admin/members').set(auth(editor)).send({ username: 'sneak', password: MEMBER_PASSWORD })).status,
      403
    );
    assert.equal((await request(app).delete('/api/admin/members/mem_x').set(auth(editor))).status, 403);
  });

  it('counts readers on the dashboard', async () => {
    const { app } = await boot();
    const admin = await tokenFor(app);
    await memberTokenFor(app, 'counted.one');
    await memberTokenFor(app, 'counted.two');
    const stats = await request(app).get('/api/admin/stats').set(auth(admin));
    assert.equal(stats.status, 200);
    assert.equal(stats.body.members.total, 2);
    assert.equal(stats.body.members.active, 2);
  });
});

describe('the team section has its own tick', () => {
  const teamAdmins = () => [
    { username: 'admin', password: PASSWORD },
    { username: 'content', password: PASSWORD, permissions: ['content'] },
    { username: 'teammate', password: PASSWORD, permissions: ['team'] }
  ];

  it('takes team writes away from the content permission', async () => {
    const { app } = await boot({ admins: teamAdmins() });
    const content = await tokenFor(app, 'content');
    assert.equal((await request(app).get('/api/admin/team').set(auth(content))).status, 403);
    const denied = await request(app)
      .post('/api/admin/team')
      .set(auth(content))
      .send({ name_fa: 'ن', name_en: 'N', role_fa: 'ر', role_en: 'R', initials: 'XX' });
    assert.equal(denied.status, 403);
    assert.equal((await request(app).get('/api/admin/comics').set(auth(content))).status, 200, 'content still works');
  });

  it('lets a team-only account edit the team and nothing else', async () => {
    const { app } = await boot({ admins: teamAdmins() });
    const teammate = await tokenFor(app, 'teammate');
    const created = await request(app)
      .post('/api/admin/team')
      .set(auth(teammate))
      .send({ name_fa: 'نگهبان', name_en: 'Keeper', role_fa: 'ویرایشگر', role_en: 'Editor', initials: 'KP' });
    assert.equal(created.status, 201);
    assert.equal((await request(app).put(`/api/admin/team/${created.body.id}`).set(auth(teammate))
      .send({ name_fa: 'نگهبان', name_en: 'Keeper', role_fa: 'سرپرست', role_en: 'Lead', initials: 'KP' })).status, 200);
    assert.equal((await request(app).delete(`/api/admin/team/${created.body.id}`).set(auth(teammate))).status, 200);
    assert.equal((await request(app).get('/api/admin/articles').set(auth(teammate))).status, 403);
    assert.equal((await request(app).get('/api/admin/members').set(auth(teammate))).status, 403);
  });

  it('still lists the team on the public bootstrap', async () => {
    const { app } = await boot({ admins: teamAdmins() });
    const res = await request(app).get('/api/bootstrap');
    assert.ok(res.body.team.length > 0, 'readers do not need an admin permission to see the team');
  });
});

describe('the contact inbox against a script', () => {
  const message = { name: 'Fan', email: 'fan@deadverse.io', subject: 'Hi', message: 'Loved the phase six notes.' };

  it('stores a human submission', async () => {
    const { app, repo } = await boot();
    const res = await request(app).post('/api/contact').send(await withChallenge(app, message));
    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);
    const admin = await tokenFor(app);
    const inbox = await request(app).get('/api/admin/messages').set(auth(admin));
    assert.equal(inbox.body.length, 1);
    assert.equal(inbox.body[0].email, message.email);
  });

  it('refuses a submission with no challenge, a wrong answer or a token from another machine', async () => {
    const { app } = await boot();
    const missing = await request(app).post('/api/contact').send(message);
    assert.equal(missing.status, 400, 'no free pass for a plain POST');

    const fresh = await request(app).get('/api/challenge');
    const wrong = await request(app)
      .post('/api/contact')
      .send({ ...message, challenge: fresh.body.token, answer: '999999' });
    assert.equal(wrong.status, 400);

    const elsewhere = await request(app)
      .post('/api/contact')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ ...message, challenge: fresh.body.token, answer: solveQuestion(fresh.body.question) });
    assert.equal(elsewhere.status, 400, 'a token is tied to the IP that was issued the question');

    const inbox = await request(app).get('/api/admin/messages').set(auth(await tokenFor(app)));
    assert.equal(inbox.body.length, 0);
  });

  it('drops a honeypot submission as quietly as a success', async () => {
    const { app } = await boot();
    const res = await request(app)
      .post('/api/contact')
      .send(await withChallenge(app, { ...message, website: 'http://bot.example' }));
    assert.equal(res.status, 201);
    assert.equal(res.body.ok, true);
    const inbox = await request(app).get('/api/admin/messages').set(auth(await tokenFor(app)));
    assert.equal(inbox.body.length, 0, 'the bot is never told it was caught, and nothing is stored');
  });

  it('rejects the same text twice', async () => {
    const { app } = await boot();
    assert.equal((await request(app).post('/api/contact').send(await withChallenge(app, message))).status, 201);
    const again = await request(app).post('/api/contact').send(await withChallenge(app, message));
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /همین چند وقت/i);

    const changed = await request(app)
      .post('/api/contact')
      .send(await withChallenge(app, { ...message, message: 'A different question entirely.' }));
    assert.equal(changed.status, 201);
  });

  it('makes one reader wait between messages', async () => {
    const { app } = await boot({ env: { contactCooldownMinutes: 60 } });
    assert.equal((await request(app).post('/api/contact').send(await withChallenge(app, message))).status, 201);
    const soon = await request(app)
      .post('/api/contact')
      .send(await withChallenge(app, { ...message, subject: 'Again', message: 'Totally different words.' }));
    assert.equal(soon.status, 429);
    assert.equal(soon.body.error.code, 'cooldown');

    const other = await request(app)
      .post('/api/contact')
      .send(await withChallenge(app, { ...message, email: 'someone.else@deadverse.io' }));
    assert.equal(other.status, 201, 'the wait is per address, not for the whole site');
  });

  it('hands out a maths question that only a fresh token answers', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/challenge');
    assert.equal(res.status, 200);
    assert.match(res.body.question, /[۰-۹]+ [+×] [۰-۹]+ = ؟/);
    assert.equal(res.body.turnstile_sitekey, '');
    assert.match(res.headers['cache-control'], /no-store/);
    assert.ok(res.body.token.split('.')[0].length > 10);

    const tampered = await request(app)
      .post('/api/contact')
      .send({ ...message, challenge: res.body.token.split('.')[0] + '.deadbeef', answer: solveQuestion(res.body.question) });
    assert.equal(tampered.status, 400, 'the signature is checked, not just the payload');
  });

  it('accepts Persian, Arabic-Indic and latin digits alike', async () => {
    const { app } = await boot();
    const res = await request(app).get('/api/challenge');
    const answer = solveQuestion(res.body.question);
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const asPersian = String(answer).replace(/\d/g, (d) => persian[Number(d)]);
    const stored = await request(app)
      .post('/api/contact')
      .send({ ...message, challenge: res.body.token, answer: ` ${asPersian} ` });
    assert.equal(stored.status, 201, `${res.body.question} should accept ${asPersian}`);
  });
});
