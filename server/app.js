import express from 'express';
import cors from 'cors';
import { loadEnv } from './env.js';
import { errorHandler, notFoundHandler, unauthorized } from './errors.js';
import { verifyToken, bearerFrom } from './auth.js';
import { rateLimit } from './rate-limit.js';
import { makeRepo } from './repo.js';
import { buildRoutes } from './routes.js';
import { MAX_MEDIA_BYTES, ownedMediaIds } from './media.js';
import { servePages } from './pages.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function allowOrigins(allowed) {
  // The cors origin callback must always be invoked, even for the "allow
  // everything" case, or the request never continues.
  if (!allowed.length) return (origin, cb) => cb(null, true);
  const set = new Set(allowed);
  return (origin, cb) => {
    if (!origin || set.has(origin)) return cb(null, true);
    return cb(null, false);
  };
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

export function createApp(overrides = {}) {
  const env = overrides.env || loadEnv();
  const repo = overrides.repo;
  const db = overrides.db;

  if (!repo) throw new Error('createApp requires a repo');

  const app = express();
  app.disable('x-powered-by');
  // Vercel terminates TLS, so the real client IP arrives in x-forwarded-for.
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: allowOrigins(env.allowedOrigins),
      methods: ALLOWED_METHODS,
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600
    })
  );
  // Uploads arrive as raw bytes on the media route; everything else is JSON.
  const jsonBody = express.json({ limit: '512kb' });
  const rawMediaBody = express.raw({ type: () => true, limit: MAX_MEDIA_BYTES });
  const isMediaUpload = (req) =>
    req.method === 'POST' && /\/admin\/media\/?$/.test(req.path);
  app.use((req, res, next) => (isMediaUpload(req) ? rawMediaBody : jsonBody)(req, res, next));
  app.use(securityHeaders);

  const ctx = {
    env,
    repo,
    db,
    withTransaction:
      overrides.withTransaction ||
      (async (fn) => {
        if (!db) throw new Error('createApp requires db or an injected withTransaction');
        return db.transaction((tx) => fn(makeRepo(tx)));
      }),
    limiter: overrides.limiter || {
      login: rateLimit({ name: 'login', limit: 8, windowMs: 5 * 60_000, message: 'زیادی تلاش کردید، کمی بعدتر دوباره امتحان کنید' }),
      contact: rateLimit({ name: 'contact', limit: 6, windowMs: 10 * 60_000, message: 'خیلی زود پیام می‌فرستید' }),
      newsletter: rateLimit({ name: 'newsletter', limit: 8, windowMs: 10 * 60_000, message: 'خیلی زود عضو می‌شوید' }),
      upload: rateLimit({ name: 'upload', limit: 40, windowMs: 60_000, message: 'خیلی سریع تصویر آپلود می‌کنید، کمی صبر کنید' })
    },
    async getAdminFromRequest(req) {
      const token = bearerFrom(req);
      if (!token || !env.jwtSecret) return null;
      let payload;
      try {
        payload = verifyToken(token, env.jwtSecret);
      } catch {
        throw unauthorized('نشست شما منقضی شده است، دوباره وارد شوید');
      }
      const admin = await repo.findAdminById(payload.sub);
      if (!admin || admin.token_version !== payload.tv) return null;
      if (admin.is_active === false) return null;
      return admin;
    },
    releaseMedia: overrides.releaseMedia || (async (ids) => {
      const owned = ownedMediaIds(ids);
      if (!owned.length) return;
      try {
        await repo.deleteMedia(owned);
      } catch (err) {
        // The content row is already gone; orphaned bytes are reported, not fatal.
        console.error('[media] release failed:', owned.join(', '), err.message);
      }
    })
  };

  const router = buildRoutes(ctx);
  // Local dev only: the deployed copy is static and Vercel does these rewrites.
  if (overrides.pagesRoot) app.use(servePages({ rootDir: overrides.pagesRoot }));
  app.use('/api', router);
  // Some hosts hand the function the rewritten path; keep the bare mount so the
  // same app works behind any proxy that strips the /api prefix.
  app.use('/', router);

  app.use(notFoundHandler);
  app.use(errorHandler(env));

  return app;
}
