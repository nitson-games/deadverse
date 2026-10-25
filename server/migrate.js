import 'dotenv/config';
import crypto from 'node:crypto';
import { createDb, closePool } from './db.js';
import { makeRepo } from './repo.js';
import { readSchemaSql } from './env.js';
import { hashPassword } from './auth.js';
import { SITE_SEED, seedInputs } from './seed.js';
import { ALL_PERMISSIONS } from './permissions.js';
import { parseEntityInput } from './validate.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(length = 16) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

function formatBytes(count) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = count;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 || value >= 10 ? 0 : 1)} ${units[unit]}`;
}

async function main() {
  const env = process.env;
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL تنظیم نشده است. فایل .env را از روی .env.example بسازید.');
    process.exit(1);
  }

  const db = createDb();
  const repo = makeRepo(db);

  console.log('→ ساخت جداول (idempotent) ...');
  await db.query(readSchemaSql());

  // Accounts that predate the permission layer get the full set once, identified
  // by the NULL the ALTER left behind; an emptied account is {} and stays that way.
  const backfilled = await db.query(
    'UPDATE admins SET permissions = $1::text[] WHERE permissions IS NULL RETURNING username',
    [ALL_PERMISSIONS]
  );
  if (backfilled.rows.length) {
    console.log(`→ دسترسی کامل به ${backfilled.rows.map((r) => r.username).join(', ')} داده شد`);
  }

  /*
   * `team` and `members` are new keys, and nobody can switch them on for
   * themselves — editing your own permissions is blocked to prevent lockout. So
   * the migration hands them out by the same rule the rest of the layer follows:
   * whoever could already edit content keeps editing the team (that is what the
   * old single `content` key meant), and whoever manages staff also gets the new
   * member list. Sub-admins created afterwards receive exactly their own ticks.
   */
  const grants = [
    { key: 'team', holds: 'content', label: 'ویرایش تیم' },
    { key: 'members', holds: 'admins', label: 'بخش عضوها' }
  ];
  for (const grant of grants) {
    const { rows } = await db.query(
      `UPDATE admins
          SET permissions = array_append(permissions, $1)
        WHERE $2 = ANY(permissions) AND NOT ($1 = ANY(permissions))
        RETURNING username`,
      [grant.key, grant.holds]
    );
    if (rows.length) {
      console.log(`→ دسترسی «${grant.label}» به ${rows.map((r) => r.username).join(', ')} اضافه شد`);
    }
  }

  const admins = await repo.countAdmins();
  let credentials = null;
  if (admins === 0) {
    const username = (env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const password = env.ADMIN_PASSWORD || generatePassword();
    const created = await repo.createAdmin({
      username,
      passwordHash: await hashPassword(password),
      displayName: env.ADMIN_DISPLAY_NAME || 'Admin',
      permissions: ALL_PERMISSIONS
    });
    credentials = { username, password, id: created.id, generated: !env.ADMIN_PASSWORD };
    console.log(`→ ادمین ساخته شد: ${username}`);
  } else {
    console.log(`→ ${admins} ادمین موجود است؛ چیزی ساخته نشد.`);
  }

  const types = ['comic', 'article', 'movie', 'character', 'team'];
  for (const type of types) {
    const existing = await repo.count(type);
    if (existing > 0) {
      console.log(`→ ${type}: ${existing} رکورد (بدون تغییر)`);
      continue;
    }
    for (const input of seedInputs(type)) await repo.create(type, parseEntityInput(type, input));
    console.log(`→ ${type}: ${seedInputs(type).length} رکورد پیش‌فرض seed شد`);
  }

  // Content written before per-item pages has an empty slug; without this the
  // new /comics/<address> links would 404 for every existing record.
  for (const type of types) {
    if (!repo.entities[type].hasSlug) continue;
    const filled = await repo.backfillSlugs(type);
    if (filled) console.log(`→ ${type}: ${filled} آدرس تازه ساخته شد`);
  }

  if (!(await repo.getSite())) {
    await repo.saveSite(SITE_SEED);
    console.log('→ تنظیمات سایت پیش‌فرض ذخیره شد');
  } else {
    console.log('→ تنظیمات سایت از قبل وجود دارد');
  }

  const usage = await repo.mediaUsage();
  console.log(
    `→ تصاویر: ${usage.count} فایل در جدول media (${formatBytes(usage.bytes)}) — آپلود از پنل فعال است.`
  );

  if (credentials) {
    console.log('\n========== حساب ادمین اولیه ==========');
    console.log(`  username: ${credentials.username}`);
    if (credentials.generated) {
      console.log(`  password: ${credentials.password}`);
      console.log('  همین حالا از بخش «🔐 رمز عبور» پنل این رمز را عوض کنید.');
    } else {
      console.log('  password: از ADMIN_PASSWORD در فایل .env خوانده شد (اینجا چاپ نمی‌شود).');
    }
    console.log('  برای ساخت حساب‌های بیشتر با دسترسی محدود، بخش «👤 ادمین‌ها» را ببینید.');
    console.log('=======================================\n');
  }

  await closePool();
}

main().catch(async (err) => {
  console.error('migrate failed:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});
