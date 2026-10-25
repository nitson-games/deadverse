import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.js');
const source = fs.readFileSync(CONFIG_PATH, 'utf8');

/**
 * config.js is a browser file, so the only honest way to test it is to run it
 * inside a stub window. The address the client picks is what broke the moment a
 * custom domain was added, and that is exactly the behaviour pinned here.
 */
function loadClient(href) {
  const url = new URL(href);
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  const window = {
    location: { protocol: url.protocol, hostname: url.hostname, search: url.search },
    sessionStorage: storage,
    localStorage: storage
  };
  window.window = window;
  // Only `window` plus URLSearchParams — what a browser supplies on top of the
  // language itself. Everything else the file uses is its own realm's builtins.
  vm.runInNewContext(source, { window, URLSearchParams });
  return { client: window.DEADVERSE, store };
}

test('the client asks its own origin for the API on every real host', () => {
  for (const href of [
    'https://deadverse.ir/',
    'https://www.deadverse.ir/',
    'https://deadverse.ir/articles/the-best-comics-of-2025',
    'https://deadverse.vercel.app/',
    'https://deadverse-git-main.vercel.app/',
    'http://deadverse.ir/'
  ]) {
    const { client } = loadClient(href);
    assert.equal(client.apiBase, '/api', `${href} باید همان-مبدأ باشد`);
    assert.equal(client.environment(), 'production', `${href} باید production خوانده شود`);
  }
});

test('a custom domain needs no CORS entry to reach the API', () => {
  const { client } = loadClient('https://www.deadverse.ir/');
  // A cross-origin base would need the domain in ALLOWED_ORIGINS and would fail
  // silently on every visitor's phone; media URLs must not go there either.
  assert.ok(!/^https?:/.test(client.apiBase), 'آدرس API نباید کامل (cross-origin) باشد');
  assert.equal(client.mediaSrc('/api/media/md_abc'), '/api/media/md_abc');
  assert.equal(
    client.mediaSrc('https://other-host.example.com/x.jpg'),
    'https://other-host.example.com/x.jpg'
  );
  assert.equal(client.mediaSrc('not-a-url'), '');
});

test('local files and localhost fall back to the dev server', () => {
  assert.equal(loadClient('file:///C:/site/index.html').client.apiBase, 'http://127.0.0.1:3000/api');
  assert.equal(loadClient('http://localhost:5500/').client.apiBase, 'http://127.0.0.1:3000/api');
  assert.equal(loadClient('http://127.0.0.1:3000/admin').client.apiBase, 'http://127.0.0.1:3000/api');
  assert.equal(loadClient('http://127.0.0.1:3000/').client.environment(), 'local');
});

test('?api= overrides the host, which is how a static-only copy points elsewhere', () => {
  const { client } = loadClient('https://nitson-games.github.io/deadverse/?api=https://deadverse.vercel.app/api/');
  assert.equal(client.apiBase, 'https://deadverse.vercel.app/api');
  assert.equal(client.environment(), 'external');
});

test('page links stay root-relative so they work on any domain', () => {
  const { client } = loadClient('https://www.deadverse.ir/');
  assert.equal(client.pageHref('article', { slug: 'the-new-dcu-a-fresh-start' }), '/articles/the-new-dcu-a-fresh-start');
  assert.equal(client.pageHref('movie', { id: 'mv_1' }), '/movies/mv_1');
  assert.equal(client.pageHref('comic', null), '');
  assert.equal(client.pageHref('team', { slug: 'x' }), '', 'بخش تیم صفحه‌ی جدا ندارد');
});

test('admin and reader tokens never share a slot', () => {
  const { client, store } = loadClient('https://www.deadverse.ir/');
  client.setToken('admin.token');
  client.setMember('member.token', { username: 'reader' });
  assert.equal(client.token(), 'admin.token');
  assert.equal(client.memberToken(), 'member.token');
  assert.deepEqual(Object.entries(client.member()), [['username', 'reader']]);
  assert.equal(store.get('dv_token'), 'admin.token');
  assert.equal(store.get('dv_member_token'), 'member.token');

  client.setToken('');
  client.setMember('');
  assert.equal(client.token(), '');
  assert.equal(client.memberToken(), '');
  assert.equal(client.member(), null);
});

test('field errors are flattened to the field names the forms show', () => {
  const { client } = loadClient('https://www.deadverse.ir/');
  // Objects built inside the sandbox carry that realm's prototype, so compare
  // their entries instead of the objects themselves.
  assert.deepEqual(
    Object.entries(client.fieldErrors({ details: [{ field: 'watchUrl', message: 'لینک نامعتبر' }, { message: 'بی‌نام' }] })),
    [['watchUrl', 'لینک نامعتبر']]
  );
  assert.deepEqual(Object.entries(client.fieldErrors(null)), []);
});
