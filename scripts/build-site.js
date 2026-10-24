import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../server/pages.js';

/**
 * Vercel publishes `outputDirectory` as the static root, and with `.` as the
 * root it also served `server/*.js` to anyone who typed the path. The public
 * build therefore contains only the pages the app knows how to serve.
 */
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(rootDir, 'public');
const files = [...new Set(PAGES.values())];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  copyFileSync(join(rootDir, file), join(outDir, basename(file)));
}

/**
 * Publishing an output folder that contains `index.html` makes Vercel answer
 * every unknown path with that page and status 200, which hides typos from
 * logs and from `npm run verify`. A `404.html` in the same folder wins, so the
 * missing paths actually say so.
 */
writeFileSync(
  join(outDir, '404.html'),
  `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>۴۰۴ — DEADVERSE</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#e8e6e1;font-family:system-ui,sans-serif;text-align:center">
<main>
  <p style="font-size:4rem;margin:0;line-height:1">۴۰۴</p>
  <p style="margin:.75rem 0 0">چنین صفحه‌ای وجود ندارد.</p>
  <p style="margin:.75rem 0 0"><a href="/" style="color:#c0392b">بازگشت به DEADVERSE</a></p>
</main>
</body>
</html>
`
);

console.log(`public/ ← ${files.join(', ')} + 404.html`);
