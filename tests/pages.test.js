import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import request from 'supertest';
import { boot } from './helpers.js';
import { PAGES } from '../server/pages.js';

function fakeSiteDir() {
  const dir = mkdtempSync(join(tmpdir(), 'deadverse-pages-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>site</body></html>');
  writeFileSync(join(dir, 'admin.html'), '<html><body>panel with loginScreen</body></html>');
  writeFileSync(join(dir, 'config.js'), 'window.DEADVERSE = {};');
  writeFileSync(join(dir, '.env'), 'ADMIN_PASSWORD=should-never-travel-over-http');
  writeFileSync(join(dir, 'package.json'), '{"secret":"nope"}');
  return dir;
}

describe('local page serving', () => {
  it('serves the site at / and the panel at /admin, like the deployed rewrite', async () => {
    const rootDir = fakeSiteDir();
    try {
      const { app } = await boot({ pagesRoot: rootDir });
      const site = await request(app).get('/');
      assert.equal(site.status, 200);
      assert.match(site.headers['content-type'], /^text\/html/);
      assert.ok(site.text.includes('site'));
      assert.equal(site.headers['cache-control'], 'no-store', 'a dev copy must not come from the browser cache');

      const panel = await request(app).get('/admin');
      assert.equal(panel.status, 200);
      assert.ok(panel.text.includes('loginScreen') || panel.text.includes('panel'));

      const direct = await request(app).get('/admin.html');
      assert.equal(direct.status, 200, 'the file is reachable under its own name too, as on Vercel');

      const config = await request(app).get('/config.js');
      assert.equal(config.status, 200);
      assert.match(config.headers['content-type'], /javascript/);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('redirects the old panel address to /admin', async () => {
    const rootDir = fakeSiteDir();
    try {
      const { app } = await boot({ pagesRoot: rootDir });
      const res = await request(app).get('/adminpanel.html');
      assert.equal(res.status, 307);
      assert.equal(res.headers.location, '/admin');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('refuses every path that is not on the page list', async () => {
    const rootDir = fakeSiteDir();
    try {
      const { app } = await boot({ pagesRoot: rootDir });
      for (const path of ['/.env', '/server/app.js', '/package.json', '/node_modules', '/../.env']) {
        const res = await request(app).get(path);
        assert.equal(res.status, 404, `${path} must not be readable`);
        assert.ok(!String(res.text).includes('should-never-travel-over-http'));
        assert.ok(!String(res.text).includes('nope'));
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('leaves the API untouched and keeps pages out of a plain app', async () => {
    const { app } = await boot();
    assert.equal((await request(app).get('/api/health')).status, 200);
    assert.equal((await request(app).get('/')).status, 404);
    assert.equal((await request(app).get('/admin')).status, 404);
  });

  it('lists only files that exist in the repo, so the deploy build cannot miss one', () => {
    for (const file of new Set(PAGES.values())) {
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} is on the page list but missing from the repo`);
    }
  });
});
