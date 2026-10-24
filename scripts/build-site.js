import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
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

console.log(`public/ ← ${files.join(', ')}`);
