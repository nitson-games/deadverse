import 'dotenv/config';
import assert from 'node:assert/strict';

/**
 * End-to-end check against a real database. The unit suite covers the HTTP
 * layer; this covers the actual SQL: constraints, ordering, numeric casts and
 * the ON CONFLICT paths that only Postgres can answer for.
 *
 *   npm run verify                                   -> boots the API on a random port against DATABASE_URL
 *   npm run verify -- https://x.vercel.app           -> checks a deployed API
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=... npm run verify
 */
const REMOTE = process.argv[2] || '';
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✘ ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}

function api(path) {
  return `${base}${path}`;
}

let base = '';
let origin = '';
let server = null;
let db = null;

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(api(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: payload, retryAfter: Number(response.headers.get('retry-after')) || 0 };
}

/**
 * Every login shares one IP bucket on the server and a full run makes about eight
 * of them, so a retry-after-the-window is the honest answer to a 429 here — the
 * alternative is reporting a working rate limiter as a product failure.
 */
async function login(body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call('/admin/login', { method: 'POST', body });
    if (res.status !== 429) return res;
    const wait = Math.min(res.retryAfter || 60, 300);
    console.log(`      · سقف تلاش ورود فعال است — ${wait} ثانیه صبر می‌کنم`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
  return call('/admin/login', { method: 'POST', body });
}

/** A real 1×1 PNG — the API decides the type from these bytes, not the header. */
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** Uploads go out as the raw file bytes, exactly like the panel does. */
async function uploadMedia(bytes, { token, contentType = 'image/png' } = {}) {
  const response = await fetch(api('/admin/media'), {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: bytes
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: payload, headers: response.headers };
}

async function fetchMedia(id) {
  const response = await fetch(api(`/media/${id}`));
  return { status: response.status, headers: response.headers, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function main() {
  if (REMOTE) {
    origin = REMOTE.replace(/\/+$/, '');
    base = `${origin}/api`;
    console.log(`\nDEADVERSE verify — حالت راه دور: ${base}`);
  } else {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL تنظیم نشده است. .env را از روی .env.example بسازید.');
      process.exit(1);
    }
    const { createApp } = await import('./app.js');
    const { createDb } = await import('./db.js');
    const { makeRepo } = await import('./repo.js');
    db = createDb();
    const app = createApp({ db, repo: makeRepo(db), pagesRoot: process.cwd() });
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    base = `${origin}/api`;
    console.log(`\nDEADVERSE verify — Neon: ${mask(process.env.DATABASE_URL)}`);
  }

  console.log('\n— عمومی');
  let bootstrap = null;
  await check('/api/health پاسخ می‌دهد', async () => {
    const res = await call('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  await check('سایت در / و پنل در /admin باز می‌شود', async () => {
    const site = await fetch(`${origin}/`);
    assert.equal(site.status, 200, 'صفحه‌ی اصلی پیدا نشد');
    assert.match(site.headers.get('content-type') || '', /text\/html/);
    assert.ok((await site.text()).includes('DEADVERSE'), 'عنوان سایت در صفحه نیست');

    const panel = await fetch(`${origin}/admin`);
    assert.equal(panel.status, 200, 'پنل باید روی مسیر تمیز /admin باز شود');
    assert.match((await panel.text()), /id="loginScreen"/, 'فرم ورود پنل در /admin نیست');
  });

  await check('آدرس قدیمی پنل به /admin ریدایرکت می‌شود و فایل‌های خصوصی خوانده نمی‌شوند', async () => {
    const old = await fetch(`${origin}/adminpanel.html`, { redirect: 'manual' });
    assert.equal(old.status, 307, '/adminpanel.html باید به /admin برود');
    assert.equal(old.headers.get('location'), '/admin');
    for (const path of ['/.env', '/.env.local', '/package.json', '/server/app.js', '/server/verify.js', '/scripts/build-site.js']) {
      assert.equal((await fetch(`${origin}${path}`)).status, 404, `${path} از طریق HTTP قابل خواندن است`);
    }
  });

  await check('/api/bootstrap هر شش بخش را برمی‌گرداند', async () => {
    const res = await call('/bootstrap');
    assert.equal(res.status, 200);
    bootstrap = res.body;
    for (const key of ['site', 'comics', 'articles', 'movies', 'characters', 'team']) {
      assert.ok(key in bootstrap, `کلید ${key} وجود ندارد`);
    }
    assert.ok(Array.isArray(bootstrap.comics));
    assert.ok(bootstrap.comics.length > 0, 'دیتابیس خالی است — اول npm run db:setup');
  });

  await check('توضیحات همراه هر رکورد می‌آید (نه آرایه‌ی موقعیتی)', async () => {
    const sample = bootstrap.comics[0];
    assert.ok(sample.desc_fa.length > 5, 'desc_fa خالی است');
    assert.ok(sample.desc_en.length > 5, 'desc_en خالی است');
    assert.equal(typeof sample.year, 'number');
  });

  await check('امتیاز فیلم عدد است نه رشته (numeric cast)', async () => {
    const movie = bootstrap.movies[0];
    assert.equal(typeof movie.rating, 'number');
    assert.ok(movie.rating >= 0 && movie.rating <= 10);
  });

  await check('تنظیمات سایت از دیتابیس می‌آید', async () => {
    assert.ok(bootstrap.site.heroTitle, 'heroTitle خالی است');
    assert.ok(bootstrap.site.aboutText_fa.length > 20);
  });

  if (db) {
    console.log('\n— لایه‌ی SQL');
    await check('همه‌ی جدول‌ها ساخته شده‌اند', async () => {
      const { rows } = await db.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const found = rows.map((r) => r.table_name);
      for (const table of ['admins', 'comics', 'articles', 'movies', 'characters', 'team_members', 'messages', 'newsletter_subscribers', 'site_settings', 'media']) {
        assert.ok(found.includes(table), `جدول ${table} نیست`);
      }
    });

    await check('ستون‌های دسترسی در جدول admins وجود دارند', async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admins'`
      );
      const found = rows.map((r) => r.column_name);
      for (const column of ['permissions', 'is_active']) {
        assert.ok(found.includes(column), `ستون ${column} در admins نیست — npm run db:setup را دوباره اجرا کن`);
      }
    });

    await check('CHECK constraint ناشر نامعتبر را رد می‌کند', async () => {
      let rejected = false;
      try {
        await db.query(
          `INSERT INTO comics (id, title_fa, title_en, publisher, year) VALUES ($1,$2,$3,$4,$5)`,
          [`verify_bad_${Date.now()}`, 'x', 'x', 'Dark Horse', 2000]
        );
      } catch (err) {
        rejected = err.code === '23514';
      }
      assert.ok(rejected, 'ناشر ناماعتبار وارد شد!');
    });

    await check('مرتبه‌بندی sort_order در list رعایت می‌شود', async () => {
      const repo = (await import('./repo.js')).makeRepo(db);
      const list = await repo.list('comic');
      const orders = await Promise.all(
        list.map(async (item) => (await repo.findRaw('comic', item.id)).sort_order)
      );
      for (let i = 1; i < orders.length; i += 1) {
        assert.ok(orders[i] >= orders[i - 1], 'ترتیب sort_order بهم ریخته است');
      }
    });

    await check('نیوزلتر ایمیل تکراری را رد نمی‌کند بلکه شناسایی می‌کند', async () => {
      const repo = (await import('./repo.js')).makeRepo(db);
      const email = `verify-${Date.now()}@deadverse.test`;
      const first = await repo.subscribe(email);
      const second = await repo.subscribe(email);
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      await db.query('DELETE FROM newsletter_subscribers WHERE email = $1', [email]);
    });
  }

  console.log('\n— فرم‌های بازدیدکننده');
  let messageId = null;
  let newsletterProbe = '';
  await check('پیام تماس ذخیره و در اینباکس دیده می‌شود', async () => {
    const marker = `verify-${Date.now()}`;
    const res = await call('/contact', {
      method: 'POST',
      body: { name: 'تست خودکار', email: `${marker}@verify.local`, subject: `verify ${marker}`, message: 'بدنه‌ی تست' }
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    messageId = res.body.id;
    assert.ok(messageId);
  });

  await check('اعتبارسنجی فرم تماس ورودی خراب را رد می‌کند', async () => {
    const res = await call('/contact', { method: 'POST', body: { name: '', email: 'bad', subject: '', message: '' } });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.error.details));
  });

  await check(' عضویت نیوزلتر کار می‌کند', async () => {
    const email = `newsletter-verify-${Date.now()}@deadverse.test`;
    const first = await call('/newsletter', { method: 'POST', body: { email } });
    const second = await call('/newsletter', { method: 'POST', body: { email } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.already_subscribed, true);
    /** Left in place on purpose: the admin section below removes it through the
        same endpoint the panel uses, so the run leaves no trace either way. */
    newsletterProbe = email;
  });

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || '';

  console.log('\n— پنل ادمین');
  if (!password) {
    console.log('  • ADMIN_PASSWORD تنظیم نشده؛ بخش ادمین رد شد (برای تست کامل آن را در .env بگذار).');
    results.push({ name: 'admin checks (skipped)', ok: true, skipped: true });
    if (newsletterProbe && db) {
      await db.query('DELETE FROM newsletter_subscribers WHERE email = $1', [newsletterProbe]);
    }
  } else {
    let token = '';
    await check('ورود با رمز درست', async () => {
      const res = await login({ username, password });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      token = res.body.token;
      assert.ok(token);
    });

    await check('ورود با رمز غلط رد می‌شود', async () => {
      const res = await login({ username, password: `${password}-no` });
      assert.equal(res.status, 401);
    });

    await check('endpoint ادمین بدون توکن ۴۰۱ می‌دهد', async () => {
      const res = await call('/admin/comics');
      assert.equal(res.status, 401);
    });

    /** A run stopped with Ctrl+C leaves its rows behind, so every start sweeps
        the marker rows of earlier runs — except the two this run still needs. */
    await check('ردپای اجراهای نیمه‌تمام قبلی پاک می‌شود', async () => {
      const subscribers = await call('/admin/subscribers', { token });
      assert.equal(subscribers.status, 200);
      for (const item of subscribers.body) {
        if (item.email === newsletterProbe) continue;
        if (!/^newsletter-verify-\d+@deadverse\.test$/.test(item.email)) continue;
        assert.equal((await call(`/admin/subscribers/${item.id}`, { method: 'DELETE', token })).status, 200);
      }

      const messages = await call('/admin/messages', { token });
      assert.equal(messages.status, 200);
      for (const item of messages.body) {
        if (item.id === messageId || !/^verify-\d+@verify\.local$/.test(item.email)) continue;
        assert.equal((await call(`/admin/messages/${item.id}`, { method: 'DELETE', token })).status, 200);
      }
    });

    await check('مشترک خبرنامه از پنل حذف می‌شود (ردپای تست پاک می‌ماند)', async () => {
      const list = await call('/admin/subscribers', { token });
      assert.equal(list.status, 200);
      const row = list.body.find((s) => s.email === newsletterProbe);
      assert.ok(row, 'مشترک تستی در لیست نیست');
      assert.ok(row.id, 'لیست باید id بدهد تا بشود رکورد را حذف کرد');

      const removed = await call(`/admin/subscribers/${row.id}`, { method: 'DELETE', token });
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.email, newsletterProbe);

      const after = await call('/admin/subscribers', { token });
      assert.ok(!after.body.some((s) => s.email === newsletterProbe), 'رکورد بعد از حذف هنوز در لیست می‌آید');
      assert.equal((await call(`/admin/subscribers/${row.id}`, { method: 'DELETE', token })).status, 404);
      newsletterProbe = '';
    });

    await check('دور کامل افزودن → ویرایش → حذف کمیک', async () => {
      const created = await call('/admin/comics', {
        method: 'POST',
        token,
        body: { title_fa: 'تست صحت‌سنجی', title_en: 'Verify Probe', publisher: 'Marvel', year: 2026, desc_fa: 'الف', desc_en: 'b' }
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.id;

      const updated = await call(`/admin/comics/${id}`, {
        method: 'PUT',
        token,
        body: { ...created.body, title_en: 'Verify Probe II' }
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.title_en, 'Verify Probe II');

      const listed = await call('/admin/comics', { token });
      assert.ok(listed.body.some((c) => c.id === id), 'آیتم جدید در لیست نیست');

      const removed = await call(`/admin/comics/${id}`, { method: 'DELETE', token });
      assert.equal(removed.status, 200);
      const after = await call('/admin/comics', { token });
      assert.ok(!after.body.some((c) => c.id === id), 'آیتم حذف نشد');
    });

    await check('مقاله با هر دو تاریخ فارسی و انگلیسی ذخیره می‌شود', async () => {
      const res = await call('/admin/articles', {
        method: 'POST',
        token,
        body: {
          title_fa: 'تست', title_en: 'Verify', cat: 'news',
          date_fa: 'آبان ۱۴۰۴', date_en: 'Oct 2026', desc_fa: 'الف', desc_en: 'b'
        }
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.cat, 'news');
      assert.equal(res.body.date_en, 'Oct 2026');
      await call(`/admin/articles/${res.body.id}`, { method: 'DELETE', token });
    });

    await check('تیم: افزودن، ویرایش و حذف (باگی که قبلاً کرش می‌کرد)', async () => {
      const created = await call('/admin/team', {
        method: 'POST',
        token,
        body: { name_fa: 'تست', name_en: 'Verify', role_fa: 'نویسنده', role_en: 'Writer', initials: 'VT' }
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const edited = await call(`/admin/team/${created.body.id}`, {
        method: 'PUT',
        token,
        body: { ...created.body, role_en: 'Editor' }
      });
      assert.equal(edited.body.role_en, 'Editor');
      const removed = await call(`/admin/team/${created.body.id}`, { method: 'DELETE', token });
      assert.equal(removed.status, 200);
    });

    await check('پیام تستی در اینباکس پیدا و سپس پاک شد', async () => {
      const list = await call('/admin/messages', { token });
      assert.equal(list.status, 200);
      const found = list.body.find((m) => m.id === messageId);
      assert.ok(found, 'پیام ساخته‌شده در اینباکس نیست');
      if (messageId) {
        const removed = await call(`/admin/messages/${messageId}`, { method: 'DELETE', token });
        assert.equal(removed.status, 200);
      }
    });

    await check('تنظیمات سایت ذخیره و به مقدار قبلی برگشت', async () => {
      const before = await call('/admin/site', { token });
      assert.equal(before.status, 200);
      /** An interrupted run can leave its marker in the copy; clearing it first
          means the revert restores clean text instead of stacking suffixes. */
      for (const key of Object.keys(before.body)) {
        if (typeof before.body[key] === 'string') before.body[key] = before.body[key].replace(/·verify/g, '');
      }
      const probe = {
        ...before.body,
        heroSub_fa: `${before.body.heroSub_fa}·verify`,
        socialX: 'https://x.com/deadverse'
      };
      const saved = await call('/admin/site', { method: 'PUT', token, body: probe });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.heroSub_fa, probe.heroSub_fa);
      assert.equal(saved.body.socialX, 'https://x.com/deadverse');
      // /api/bootstrap is cached for 20 seconds on purpose, so the public page is
      // allowed to show the previous copy briefly — but not longer than that.
      let publicSite = null;
      for (let waited = 0; waited < 45_000; waited += 3_000) {
        publicSite = await call('/bootstrap');
        if (publicSite.body.site.socialX === 'https://x.com/deadverse') break;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      assert.equal(publicSite.body.site.socialX, 'https://x.com/deadverse', 'آپدیت سایت در نسخه‌ی کش‌شده public دیده نشد');
      const restored = await call('/admin/site', { method: 'PUT', token, body: before.body });
      assert.equal(restored.body.heroSub_fa, before.body.heroSub_fa);
      assert.equal(restored.body.socialX, before.body.socialX);
    });

    await check('آپلود تصویر → ذخیره در دیتابیس → سرو مجدد با کش', async () => {
      const uploaded = await uploadMedia(PNG_PIXEL, { token });
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
      const mediaId = uploaded.body.id;
      assert.match(mediaId, /^md_[0-9a-z]+$/);
      assert.equal(uploaded.body.url, `/api/media/${mediaId}`);
      assert.equal(uploaded.body.contentType, 'image/png');

      const served = await fetchMedia(mediaId);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.match(served.headers.get('cache-control') || '', /immutable/);
      assert.ok(served.buffer.equals(PNG_PIXEL), 'بایت‌های سروشده با فایل آپلودی یکی نیست');

      const cached = await fetch(api(`/media/${mediaId}`), {
        headers: { 'If-None-Match': served.headers.get('etag') || '' }
      });
      assert.equal(cached.status, 304, 'ETag درست کار نمی‌کند');

      const comic = await call('/admin/comics', {
        method: 'POST',
        token,
        body: {
          title_fa: 'تست تصویر', title_en: 'Verify Image', publisher: 'Marvel', year: 2026,
          desc_fa: 'نوشته‌ی تست', desc_en: 'verify text',
          image: uploaded.body.url, imagePublicId: mediaId
        }
      });
      assert.equal(comic.status, 201, JSON.stringify(comic.body));
      assert.equal(comic.body.image, uploaded.body.url);

      const removed = await call(`/admin/comics/${comic.body.id}`, { method: 'DELETE', token });
      assert.equal(removed.status, 200);
      /** The bust parameter skips Vercel's edge copy and asks the database,
          which is where the bytes actually live. */
      const afterDelete = await fetch(api(`/media/${mediaId}?check=${Date.now()}`));
      assert.equal(afterDelete.status, 404, 'بایت‌های تصویر بعد از حذف آیتم پاک نشد');
      if (!REMOTE) {
        // Vercel consumes this header itself and does not forward it to clients.
        assert.match(served.headers.get('vercel-cdn-cache-control') || '', /s-maxage=\d+/, 'کش لبه باید عمر محدود داشته باشد');
      }
    });

    await check('فایل غیرتصویری و بدون ورود رد می‌شوند', async () => {
      const notImage = await uploadMedia(Buffer.from('<script>alert(1)</script>'), { token });
      assert.equal(notImage.status, 400, JSON.stringify(notImage.body));
      const noAuth = await uploadMedia(PNG_PIXEL, {});
      assert.equal(noAuth.status, 401);
      const unknownId = await fetchMedia('not_a_media_id');
      assert.equal(unknownId.status, 404);
    });

    await check('خروجی پشتیبان قابل بازگردانی است', async () => {
      const backup = await call('/admin/export', { token });
      assert.equal(backup.status, 200);
      assert.ok(Array.isArray(backup.body.data.comics));
      const restored = await call('/admin/import', { method: 'POST', token, body: backup.body });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      const after = await call('/bootstrap');
      assert.equal(after.body.comics.length, backup.body.data.comics.length, 'تعداد کمیک‌ها بعد از import عوض شد');
    });

    await check('شمارش‌های داشبورد با لیست‌ها می‌خواند', async () => {
      const stats = await call('/admin/stats', { token });
      assert.equal(stats.status, 200);
      const list = await call('/admin/comics', { token });
      assert.equal(stats.body.comics, list.body.length);
    });

    console.log('\n— مدیریت ادمین‌ها');
    const staffPassword = `verify-staff-${Date.now()}`;
    const staffUsername = `verify_staff_${Date.now()}`;
    let staffId = null;

    await check('فهرست ادمین‌ها بدون هیچ رمزی برمی‌گردد', async () => {
      const res = await call('/admin/admins', { token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(Array.isArray(res.body.items) && res.body.items.length >= 1);
      assert.ok(res.body.permissions.some((p) => p.key === 'admins'));
      assert.ok(!res.body.items.some((a) => 'password_hash' in a), 'password_hash لو رفته است!');
      assert.ok(!JSON.stringify(res.body).includes(password), 'رمز در پاسخ است!');
    });

    await check('حساب جدید فقط با دسترسی‌های داده‌شده وارد می‌شود', async () => {
      const created = await call('/admin/admins', {
        method: 'POST',
        token,
        body: { username: staffUsername, display_name: 'تست دسترسی', password: staffPassword, permissions: ['content'] }
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      staffId = created.body.id;
      assert.deepEqual(created.body.permissions, ['content']);

      const session = await login({ username: staffUsername, password: staffPassword });
      assert.equal(session.status, 200, JSON.stringify(session.body));
      const staffToken = session.body.token;
      assert.equal((await call('/admin/comics', { token: staffToken })).status, 200);
      assert.equal((await call('/admin/site', { token: staffToken })).status, 403, 'باید از تنظیمات سایت رد شود');
      assert.equal((await call('/admin/admins', { token: staffToken })).status, 403, 'باید از مدیریت ادمین‌ها رد شود');
    });

    await check('حذف دسترسی، نشست قبلی را باطل و دسترسی را قطع می‌کند', async () => {
      const reauth = await login({ username: staffUsername, password: staffPassword });
      assert.equal(reauth.status, 200);
      const staffToken = reauth.body.token;
      assert.equal((await call('/admin/comics', { token: staffToken })).status, 200);

      const edited = await call(`/admin/admins/${staffId}`, {
        method: 'PUT',
        token,
        body: { display_name: 'تست دسترسی', permissions: [], is_active: true }
      });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      assert.deepEqual(edited.body.permissions, []);
      assert.equal((await call('/admin/stats', { token: staffToken })).status, 401, 'توکن قدیمی باید باطل شده باشد');

      const relogin = await login({ username: staffUsername, password: staffPassword });
      assert.equal((await call('/admin/comics', { token: relogin.body.token })).status, 403, 'بدون دسترسی باید ۴۰۳ بگیرد');
    });

    await check('خودتحریمی (کاهش دسترسی، غیرکردن یا حذف خود) رد می‌شود', async () => {
      const me = (await call('/admin/admins', { token })).body.items.find((a) => a.username === username);
      assert.ok(me, 'حساب فعلی در فهرست نیست');
      const selfPut = (permissions, is_active) =>
        call(`/admin/admins/${me.id}`, { method: 'PUT', token, body: { display_name: me.display_name, permissions, is_active } });

      assert.equal((await selfPut(['content'], true)).status, 400, 'کاهش دسترسی خود');
      assert.equal((await selfPut(me.permissions, false)).status, 400, 'خام‌کردن خود');
      assert.equal((await call(`/admin/admins/${me.id}`, { method: 'DELETE', token })).status, 400, 'حذف خود');

      const renamed = await selfPut(me.permissions, true);
      assert.equal(renamed.status, 200, 'ویرایش نام خود مجاز است');
      assert.equal((await call('/admin/stats', { token })).status, 200, 'نشست خود نباید باطل شود');
    });

    await check('رمز آن‌ها قابل بازنشانی است و حساب غیرفعال نمی‌تواند وارد شود', async () => {
      const fresh = `verify-rotated-${Date.now()}`;
      const reset = await call(`/admin/admins/${staffId}/password`, { method: 'POST', token, body: { password: fresh } });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      const off = await call(`/admin/admins/${staffId}`, {
        method: 'PUT',
        token,
        body: { display_name: 'تست دسترسی', permissions: ['content'], is_active: false }
      });
      assert.equal(off.status, 200);
      assert.equal(off.body.is_active, false);
      const attempt = await login({ username: staffUsername, password: fresh });
      assert.equal(attempt.status, 401, 'حساب غیرفعال نباید وارد شود');
    });

    await check('حذف حساب تستی', async () => {
      const removed = await call(`/admin/admins/${staffId}`, { method: 'DELETE', token });
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      const list = await call('/admin/admins', { token });
      assert.ok(!list.body.items.some((a) => a.id === staffId), 'حساب تستی باقی مانده است');
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} بررسی موفق.`);
  if (failed.length) {
    console.log('موفق نشد:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.err?.message}`));
  }
  if (server) server.close();
  if (db) (await import('./db.js')).closePool();
  process.exit(failed.length ? 1 : 0);
}

function mask(url) {
  return url.replace(/:[^:@/]+@/, ':****@');
}

main().catch(async (err) => {
  console.error('verify متوقف شد:', err.message);
  if (server) server.close();
  process.exit(1);
});
