import request from 'supertest';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { ALL_PERMISSIONS } from '../server/permissions.js';
import { SITE_SEED, seedInputs } from '../server/seed.js';
import { parseEntityInput } from '../server/validate.js';
import { createStore, makeFakeRepo } from './fake-repo.js';

export const PASSWORD = 'Correc-Horse-Battery-9';
export const EXTERNAL_IMG = 'https://example.com/images/deadverse/comics/one.jpg';
export const EXTERNAL_PID = 'legacy-external-id';

/** A real 1×1 PNG — the API reads the type from these bytes, not the header. */
export const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function baseEnv(overrides = {}) {
  return {
    databaseUrl: 'postgres://fake',
    jwtSecret: 'test-secret-value-that-is-long-enough',
    tokenTtl: '1h',
    memberTokenTtl: '1h',
    turnstile: { siteKey: '', secret: '' },
    contactCooldownMinutes: 0,
    allowedOrigins: [],
    bootstrapAdmin: { username: 'admin', password: '' },
    nodeEnv: 'test',
    ...overrides
  };
}

const noLimiter = {
  login: passThrough,
  memberLogin: passThrough,
  signup: passThrough,
  challenge: passThrough,
  contact: passThrough,
  newsletter: passThrough,
  upload: passThrough
};

function passThrough(req, res, next) {
  next();
}

export async function boot({ env = {}, admins = [{ username: 'admin', password: PASSWORD }], pagesRoot = null } = {}) {
  const store = createStore();
  const repo = makeFakeRepo(store);
  for (const admin of admins) {
    await repo.createAdmin({
      username: admin.username,
      passwordHash: await hashPassword(admin.password),
      displayName: admin.displayName || 'Admin',
      permissions: admin.permissions ?? ALL_PERMISSIONS,
      isActive: admin.isActive ?? true
    });
  }
  for (const type of Object.keys(store.tables)) {
    for (const input of seedInputs(type)) await repo.create(type, parseEntityInput(type, input));
  }
  await repo.saveSite(SITE_SEED);

  const app = createApp({
    repo,
    env: baseEnv(env),
    limiter: env.useRealLimiter ? undefined : noLimiter,
    withTransaction: async (fn) => fn(repo),
    pagesRoot
  });
  return { app, repo, store };
}

export async function tokenFor(app, username = 'admin', password = PASSWORD) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  return res.body.token;
}

const PERSIAN_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** Reads the maths question back the way a person would, so the tests exercise
    the real signed challenge instead of a stubbed gate. */
export function solveQuestion(question) {
  const ascii = String(question).replace(/[۰-۹]/g, (d) => PERSIAN_DIGITS[d]);
  const match = ascii.match(/(\d+)\s*([+×])\s*(\d+)/);
  if (!match) throw new Error(`challenge question not understood: ${question}`);
  const [a, op, b] = [Number(match[1]), match[2], Number(match[3])];
  return String(op === '×' ? a * b : a + b);
}

/** A body carrying a fresh, correctly answered challenge for this client IP. */
export async function withChallenge(app, body = {}) {
  const res = await request(app).get('/api/challenge');
  if (res.status !== 200) throw new Error(`challenge endpoint answered ${res.status}`);
  return { ...body, challenge: res.body.token, answer: solveQuestion(res.body.question) };
}

export const MEMBER_PASSWORD = 'Reader-Pass-1234';

export async function memberTokenFor(app, username = 'reader.one', password = MEMBER_PASSWORD) {
  const res = await request(app)
    .post('/api/member/signup')
    .send(await withChallenge(app, { username, password, display_name: 'First Reader' }));
  if (res.status !== 201) throw new Error(`member signup answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}
