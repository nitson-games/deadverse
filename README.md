# DEADVERSE — سایت + پنل ادمین + بک‌اند رایگان

سایت فارسی/انگلیسی ددورس (کمیک، مقاله، فیلم، شخصیت، تیم) با پنل ادمین واقعی.
فرانت‌اند همان HTML قبلی است، فقط از `localStorage` به API وصل شده.

**پشته (همه روی پلن رایگان):**

| بخش | سرویس | هزینه |
|---|---|---|
| صفحه‌ی سایت و پنل | GitHub Pages (`nitson-games.github.io/deadverse`) | رایگان |
| API | Vercel (Node serverless) | رایگان (Hobby) |
| دیتابیس | Neon PostgreSQL | رایگان |
| تصاویر | Cloudinary (آپلود مستقیم از مرورگر) | رایگان |

---

## ۱. ساخت دیتابیس روی Neon

**راه اول (سریع‌ترین، از CLI ورسِل — چیزی که واقعاً استفاده شد):**

```bash
npx vercel link --project deadverse --yes
npx vercel integration add neon     # دیتابیس Free می‌سازد و DATABASE_URL را به env تزریق می‌کند
npx vercel env pull .env.local      # برای اجرای محلی: همان رشته را روی دیسک می‌آورد
```

`integration add neon` این متغیرها را برای Production/Preview/Development می‌سازد: `DATABASE_URL` (pooled)، `DATABASE_URL_UNPOOLED`، `POSTGRES_*`، `PG*`. برای این پروژه فقط `DATABASE_URL` مصرف می‌شود. مقدارش را در `.env` محلی هم بگذار تا `npm run db:setup` از همان‌جا وصل شود.

**راه دوم (کنسول Neon، دستی):**

1. وارد [neon.tech](https://neon.tech) شو → **New Project** → نام `deadverse` → Region نزدیک خودت → Create.
2. از **Connect** (یا کارت Connection string) سوییچ **Connection pooling** را روشن کن؛ به رشته‌ای نیاز داری که نام endpointش با `-pooler` تمام می‌شود:

```
postgresql://user:****@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require
```

> حتماً **pooled** (همان `-pooler`) باشد. روی Vercel هر instance یک اتصال جدید باز می‌کند و بدون pooler از سقف اتصال پلن رایگان رد می‌شوی.

3. `?sslmode=require` در URL باشد. خود سرور هم `rejectUnauthorized: true` را ست می‌کند و `sslmode` را از رشته حذف می‌کند تا رفتار TLS با تغییر نسخه‌ی `pg` عوض نشود (در `server/db.js`).

## ۲. ساخت پروژه Cloudinary

1. [cloudinary.com](https://cloudinary.com) → Sign up رایگان.
2. از **Dashboard** این سه مقدار را بردار: `Cloud name`، `API Key`، `API Secret`.
3. **Settings → Upload settings → Signing Requests** لازم نیست؛ امضا سمت سرور ساخته می‌شود.
4. پوشه‌ی پیش‌فرض آپلودها `deadverse/` است (با `CLOUDINARY_FOLDER` عوض می‌شود) و سرور فقط فایل‌های داخل همین پوشه را می‌تواند حذف کند.

آپلود در پنل **مستقیم از مرورگر** به Cloudinary می‌رود؛ فقط URL نهایی در دیتابیس ذخیره می‌شود. یعنی فایل ۲ مگابایتی از Vercel رد نمی‌شود.

## ۳. اجرای محلی

```bash
git clone https://github.com/nitson-games/deadverse.git
cd deadverse
npm install
cp .env.example .env       # ویندوز:  copy .env.example .env
```

`.env` را پر کن (توضیح هر متغیر داخل خودش هست):

| متغیر | مقدار |
|---|---|
| `DATABASE_URL` | رشته‌ی pooled از Neon |
| `JWT_SECRET` | ۶۴ کاراکتر تصادفی ← `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `12h` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | ادمین اولیه؛ اگر رمز را خالی بگذاری خودکار ساخته و **چاپ** می‌شود |
| `ALLOWED_ORIGINS` | `https://nitson-games.github.io,http://localhost:5500,http://127.0.0.1:3000` |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` / `_FOLDER` | از Cloudinary |

ساخت جداول + ادمین + داده‌های نمونه:

```bash
npm run db:setup
```

این اسکرپیت idempotent است: اگر ادمین یا رکوردی وجود داشته باشد، دست نمی‌زند. اگر `ADMIN_PASSWORD` خالی بوده، رمز تصادفی را **همان لحظه** کپی کن.

سرور محلی و تست:

```bash
npm run dev        # http://127.0.0.1:3000/api/health
npm test           # ۳۴ تست لایه‌ی HTTP
npm run verify     # بررسی کامل روی دیتابیس واقعی (SQL، قیدها، CRUD، بکاپ)
```

موقع `npm run dev` فایل‌های HTML را با Live Server (پورت ۵۵۰۰) یا `http://localhost:3000` باز کن؛ `config.js` خودکار آدرس API لوکال را انتخاب می‌کند. برای باز کردن مستقیم با `file://` هم API آدرس `127.0.0.1:3000` را می‌گیرد.

## ۴. دیپلوی روی Vercel

دو راه دارد؛ هر دو تست شده‌اند:

**الف) از همین پوشه‌ی لوکال (بدون گیت‌هاب — چیزی که الان استفاده شده):**

```bash
export VERCEL_TOKEN=...                      # فقط در محیط، نه در فایل تحت git
npx vercel link --project deadverse --yes
npx vercel env add JWT_SECRET production     # مقدار را از stdin می‌خواند، با پولد pipe کن
printf '%s\n' "https://<آدرس>.vercel.app,https://nitson-games.github.io" | npx vercel env add ALLOWED_ORIGINS production
npx vercel deploy --prod --yes
```

**ب) از ریپوی گیت‌هاب:** ریپو باید `api/`، `server/`، `config.js`، `vercel.json` و `package.json` را داشته باشد (در نسخه‌ی فعلی هنوز پوش نشده‌اند). بعد Import → Framework: **Other**، Build/Output: **خالی** — هر مسیر `/api/*` با `vercel.json` به همان تابع می‌رسد.

نکته‌هایی که موقع دیپلوی این پروژه به آن بر خوردیم:
- در `vercel.json` **نویس `"runtime": "nodejs20.x"` ممنوع**؛ build با خطای `Function Runtimes must have a valid version` می‌میرد. نسخه‌ی Node را Vercel انتخاب می‌کند (و `engines.node` در `package.json` راهنمای آن است). `memory` هم با صورت‌حساب Fluid Compute نادیده گرفته می‌شود.
- `.vercelignore` جلوی آپلود `.env*`، `tests/` و پوشه‌های ابزار را می‌گیرد. بعد از دیپلوی چک کن: `curl -I https://<آدرس>/.env` باید **۴۰۴** بدهد.
- «Deployment Protection» روی پروژه روشن است ولی فقط **preview URL**ها را قفل می‌کند؛ آدرس production برای بازدیدکننده‌ی ناشناس باز است (با `curl -i https://<آدرس>/api/health` تأییدشده).

متغیرهای لازم روی Vercel (محیط Production):

| متغیر | از کجا |
|---|---|
| `DATABASE_URL` | خودش با `vercel integration add neon` تزریق می‌شود |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ALLOWED_ORIGINS` | آدرس production ورسِل + `https://nitson-games.github.io` |
| `CLOUDINARY_*` | فقط وقتی آپلود تصویر می‌خواهی؛ اگر نباشد امضای آپلود `503` می‌دهد و بقیه‌ی پنل کار می‌کند |

`ADMIN_USERNAME` / `ADMIN_PASSWORD` روی Vercel **لازم نیست** — فقط `npm run db:setup` روی ماشین خودت آن‌ها را می‌خواند و بعد از آن رمز به‌صورت bcrypt در دیتابیس است. آن‌ها را در داشبورد Vercel نگذار.

بعد از دیپلوی، از همان ماشین تست راه دور:

```bash
npm run verify -- https://<آدرس>.vercel.app
```

## ۵. آدرس API در `config.js`

سایت و API الان **هر دو روی Vercel** هستند، پس `config.js` خودکار `/api` (هم‌ریشه) را انتخاب می‌کند و چیزی لازم نیست. اگر نسخه‌ی GitHub Pages را هم می‌خواهی، `API_BASE` باید آدرس کامل ورسِل باشد:

```js
var API_BASE = 'https://<آدرس>.vercel.app/api';
```

قاعده انتخاب آدرس در `resolve()` این است (نیازی به تغییر ندارد، فقط بدانی):

- `?api=...` در URL → همیشه اولویت اول (برای تست موقت).
- `file://`، `localhost`، `127.0.0.1` → `http://127.0.0.1:3000/api`.
- دامنه روی `*.vercel.app` یا `*.netlify.app` → `/api` (هم‌ریشه).
- بقیه (GitHub Pages) → همان `API_BASE`.

پنل ادمین: `https://<آدرس>/adminpanel.html` (و روی Pages: `https://nitson-games.github.io/deadverse/adminpanel.html`).

## ۶. لایه‌ی اتصال و امنیت

`request()` در `config.js` تنها راه رفتن به API است: متد، هدر `Authorization: Bearer` از `sessionStorage` و `Content-Type` را می‌گذارد و پاسخ خطا را به آبجکتی با `status`، `code` و `details` (خطاهای فیلدی) تبدیل می‌کند؛ `fieldErrors()` همان `details` را به نقشه‌ی فیلد تبدیل می‌کند تا پنل زیر هر اینپوت پیام بگذارد. هیچ `eval` و `innerHTML` با داده‌ی خام کاربر نداریم؛ متن‌های خروجی با `esc()` escape می‌شوند.

پنل ادمین یک تابع `call()` دارد که همه‌ی درخواست‌ها از آن رد می‌شوند، پس ۴۰۱ همیشه به صفحه‌ی ورود برمی‌گرداند و ۴۰۳/۵۰۰ فقط toast می‌شوند.

خطاهای اعتبارسنجی با `status: 400` و آرایه‌ی `details: [{field, message}]` برمی‌گردند؛ `DEADVERSE.fieldErrors()` همان را به نقشه‌ی فیلد تبدیل می‌کند تا پیام زیر input مربوطه بنشیند. مقادیر پویا در هر دو صفحه با `esc()` escape می‌شوند و `eval` یا `new Function` در پروژه نیست. برای سقف اتصال Neon هم `DB_POOL_MAX` (پیش‌فرض ۱ در هر instance) در دسترس است.

## ۷. استفاده‌ی روزانه

- **ورود**: دیگر رمز ثابت `admin/deadverse` وجود ندارد. JWT با `token_version` است؛ با تغییر رمز، همه‌ی سشن‌های قبلی باطل می‌شود. ورود پشت rate-limit است (چند تلاش غلط → ۴۲۹ موقت).
- **رمز ادمین**: `ADMIN_USERNAME` / `ADMIN_PASSWORD` فقط در `npm run db:setup` (و فقط وقتی جدول خالی است) خوانده می‌شود و بعد از bcrypt در دیتابیس ذخیره می‌شود. این دو را فقط در `.env` محلی و در Environment Variables ووِرسِل بگذار — هیچ‌وقت در فایل‌های تحت git نه. بعد از اولین ورود می‌توانی از بخش «رمز عبور» عوضش کنی.
- **ادمین‌ها و دسترسی‌ها**: بخش «👤 ادمین‌ها» (فقط با دسترسی `admins`) حساب جدید می‌سازد: نام نمایشی، نام کاربری، رمز و تیک‌های دسترسی. شش دسترسی این‌ها هستند:
  `content` (کمیک/مقاله/فیلم/شخصیت/تیم + آپلود تصویر)، `messages`، `newsletter`، `site`، `backup` (Export/Import/Reset)، `admins`.
  - هر درخواست سمت سرور چک می‌شود؛ بدون دسترسی → `403` با پیام «دسترسی «x» برای حساب شما فعال نیست».
  - عوض‌کردن دسترسی/فعال‌بودن یک حساب، `token_version` آن را بالا می‌برد و نشست‌هایش بی‌اثر می‌شود.
  - حساب خودش نمی‌تواند دسترسی‌اش را کم کند، خودش را غیرفعال یا حذف کند — پس قفل‌شدن پنل پیش نمی‌آید. برای تغییر این موارد روی حساب خودت، باید یک ادمینِ دیگر با دسترسی `admins` وارد شود.
  - نام کاربری بعد از ساخت تغییر نمی‌کند؛ اگر لازم شد، حساب را حذف و دوباره بساز.
  - «غیرفعال» رکورد را پاک نمی‌کند؛ فقط ورود و نشست‌های آن حساب قطع می‌شود.
- **محتوا**: افزودن/ویرایش/حذف کمیک، مقاله، فیلم، شخصیت، تیم. ترتیب نمایش = ترتیبی که در لیست ذخیره می‌شود.
- **تصویر**: آپلود مستقیم؛ URL `https` ذخیره می‌شود. اگر ویرایش کنی و دوباره آپلود نکنی، تصویر قبلی و `public_id`اش حفظ می‌شود و فایل‌های یتیم (وقتی آیتم حذف می‌شود) از Cloudinary پاک می‌شوند.
- **تنظیمات سایت**: متن هیرو، درباره و دکمه‌ها در دو زبان؛ دقیقاً همان‌جا که در سایت نمایش داده می‌شود.
- **پیام‌ها / خبرنامه**: اینباکس با خوانده‌نشده، خروجی CSV مشترکین.
- **پشتیبان**: Export یک JSON کامل (محتوا + پیام‌ها + تنظیمات) و Import همان فایل. Import کل دیتابیس را بازنشانی می‌کند — قبلش فایل را نگه دار.

## ۸. رفع خطاها

| نشانه | علت / راه‌حل |
|---|---|
| پنل: «ارتباط با سرور برقرار نشد» | `API_BASE` اشتباه، یا `ALLOWED_ORIGINS` شامل آدرس Pages نیست. |
| ۴۰۱ بعد از دیپلوی مجدد | توکن در `sessionStorage` است؛ یک‌بار خارج شو و دوباره وارد شو. |
| `Missing required environment variables: DATABASE_URL, JWT_SECRET` در Vercel | متغیرها برای Environment = Production تیک نخورده‌اند؛ بعد از افزودن **Redeploy** کن. |
| آپلود تصویر ۵۰۳ `cloudinary_not_configured` | سه متغیر `CLOUDINARY_*` کامل نیست. |
| `npm run verify` می‌گوید «دیتابیس خالی است» | `npm run db:setup` اجرا نشده. |
| خطای connection / `too_many_connections` | URL بدون `-pooler` گذاشته شده. |
| سایت، داده‌ی نمونه‌ی قدیمی نشان می‌دهد + بنر «اتصال برقرار نیست» | API در دسترس نیست؛ fallback فعال شده. آدرس API را چک کن. |
| در پنل پیام «دسترسی «x» برای حساب شما فعال نیست» | حساب تو آن دسترسی را ندارد؛ با یک ادمین که دسترسی `admins` دارد وارد شو و از بخش ادمین‌ها تیکش را فعال کن (بعد از تغییر دسترسی باید دوباره وارد شوی). |
| بخش «ادمین‌ها» در منو نیست | حساب جاری دسترسی `admins` ندارد. اگر همه‌ی حساب‌ها آن را ندارند، `npm run db:setup` دوباره اجرا نمی‌شود؛ از طریق SQL: `UPDATE admins SET permissions = '{content,messages,newsletter,site,backup,admins}' WHERE username = '...'`. |
| «ستون permissions در admins نیست» در `npm run verify` | `npm run db:setup` را بعد از کشیدن آخرین نسخه اجرا کن (ALTER روی جدول قدیمی لازم است). |

## ۹. ساختار فایل‌ها

```
index.html            سایت عمومی (API-driven)
adminpanel.html       پنل ادمین (API-driven)
config.js             client مشترک: آدرس API، fetch، توکن، خطاهای فیلدی
api/index.js          ورودی serverless Vercel (Express app)
vercel.json           rewrite /api/* -> تابع (بدون `runtime`؛ نسخه Node را Vercel انتخاب می‌کند)
.vercelignore         .env*، tests/ و پوشه‌های ابزار آپلود نمی‌شوند
server/
  app.js              Express + CORS + هدرهای امنیتی + error handler
  routes.js           همه‌ی endpointها
  repo.js             کوئری‌ها (repository pattern)
  db.js               pool Neon (ssl verify، پیش‌فرض ۱ اتصال به هر instance)
  schema.sql          جداول و قیدها
  validate.js         zod: کلاینت -> ستون‌های دیتابیس
  auth.js             JWT + bcrypt
  cloudinary.js       امضای آپلود + حذف
  rate-limit.js       پنجره‌ی ثابت در حافظه
  migrate.js          npm run db:setup
  verify.js           npm run verify
tests/                ۴۵ تست HTTP با fake repo (بدون نیاز به دیتابیس)
.env.example          الگوی متغیرها
```

**`ALLOWED_ORIGINS` را با `/` انتهایی ننویس** و `JWT_SECRET` را کامیت نکن — `.gitignore` فقط فایل‌های `.env*` را از git بیرون نگه می‌دارد، پس رمزها را هیچ‌وقت مستقیم داخل HTML یا `config.js` ننویس.
