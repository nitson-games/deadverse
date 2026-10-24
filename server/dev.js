import 'dotenv/config';
import { createApp } from './app.js';
import { createDb } from './db.js';
import { makeRepo } from './repo.js';

const db = createDb();
const app = createApp({ db, repo: makeRepo(db), pagesRoot: process.cwd() });

const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => {
  const at = `http://127.0.0.1:${port}`;
  console.log(`DEADVERSE محلی بالا است:`);
  console.log(`  سایت   ${at}/`);
  console.log(`  پنل    ${at}/admin`);
  console.log(`  API    ${at}/api/health`);
  console.log('  (فایل‌های HTML را با file:// یا Live Server باز نکن — از همین آدرس‌ها استفاده کن)');
});

export default app;
