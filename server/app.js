import express from 'express';
import cors from 'cors';
import { loadEnv } from './env.js';
import { errorHandler, notFoundHandler, unauthorized } from './errors.js';
import { verifyToken, bearerFrom } from './auth.js';
import { rateLimit } from './rate-limit.js';
import { makeRepo } from './repo.js';
import { buildRoutes } from './routes.js';
import { destroyAsset, isCloudinaryConfigured } from './cloudinary.js';

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
  // Images go to Cloudinary from the browser, so nothing large needs to pass here.
  app.use(express.json({ limit: '512kb' }));
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
      newsletter: rateLimit({ name: 'newsletter', limit: 8, windowMs: 10 * 60_000, message: 'خیلی زود عضو می‌شوید' })
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
    releaseAssets: overrides.releaseAssets || (async (publicIds) => {
      if (!publicIds.length || !isCloudinaryConfigured(env.cloudinary)) return;
      for (const publicId of publicIds) {
        try {
          await destroyAsset(env.cloudinary, publicId);
        } catch (err) {
          console.error('[cloudinary] destroy failed:', publicId, err.message);
        }
      }
    })
  };

  const router = buildRoutes(ctx);
  app.use('/api', router);
  // Some hosts hand the function the rewritten path; keep the bare mount so the
  // same app works behind any proxy that strips the /api prefix.
  app.use('/', router);

  app.use(notFoundHandler);
  app.use(errorHandler(env));

  return app;
}
