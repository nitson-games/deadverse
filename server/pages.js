import { join } from 'node:path';

/**
 * Local page serving. Every browser path is looked up in this table, so no
 * other file on disk is reachable — `express.static(root)` would publish
 * `.env`, `server/` and `node_modules/` over HTTP. Content types come from the
 * extension, because only these names can be read at all.
 *
 * The deployed copy publishes exactly the files in this table (see
 * `scripts/build-site.js`), so a page can never exist locally and be missing
 * in production, or the other way round.
 */
export const PAGES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/admin', 'admin.html'],
  ['/admin.html', 'admin.html'],
  ['/item.html', 'item.html'],
  ['/config.js', 'config.js'],
  ['/favicon.svg', 'favicon.svg'],
  ['/og-cover.jpg', 'og-cover.jpg'],
]);

/**
 * One page renders every item address, because the record it shows comes from
 * the URL, not the file. These prefixes mirror the rewrites in `vercel.json` —
 * add one here and there, never in only one of the two, or a link works on the
 * dev server and 404s in production.
 */
export const ITEM_PREFIXES = ['/comics/', '/articles/', '/movies/', '/characters/'];

export const PANEL_PATH = '/admin';

export function servePages({ rootDir }) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/adminpanel.html') return res.redirect(307, PANEL_PATH);
    const file =
      PAGES.get(req.path) ||
      (ITEM_PREFIXES.some((prefix) => req.path.startsWith(prefix)) ? 'item.html' : null);
    if (!file) return next();
    // Development copies must never come out of a browser cache, or a saved
    // change looks like it did nothing.
    res.set('Cache-Control', 'no-store');
    return res.sendFile(join(rootDir, file), (err) => {
      if (err) next(err);
    });
  };
}
