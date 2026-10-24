import request from 'supertest';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { ALL_PERMISSIONS } from '../server/permissions.js';
import { SITE_SEED, seedInputs } from '../server/seed.js';
import { parseEntityInput } from '../server/validate.js';
import { createStore, makeFakeRepo } from './fake-repo.js';

export const PASSWORD = 'Correc-Horse-Battery-9';
export const CLOUD_IMG = 'https://res.cloudinary.com/demo/image/upload/deadverse/comics/one.jpg';
export const CLOUD_PID = 'deadverse/comics/one';

function baseEnv(overrides = {}) {
  return {
    databaseUrl: 'postgres://fake',
    jwtSecret: 'test-secret-value-that-is-long-enough',
    tokenTtl: '1h',
    allowedOrigins: [],
    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret', folder: 'deadverse' },
    bootstrapAdmin: { username: 'admin', password: '' },
    nodeEnv: 'test',
    ...overrides
  };
}

const noLimiter = {
  login: (req, res, next) => next(),
  contact: (req, res, next) => next(),
  newsletter: (req, res, next) => next()
};

export async function boot({ env = {}, admins = [{ username: 'admin', password: PASSWORD }] } = {}) {
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

  const released = [];
  const app = createApp({
    repo,
    env: baseEnv(env),
    limiter: env.useRealLimiter ? undefined : noLimiter,
    releaseAssets: async (pids) => released.push(...pids),
    withTransaction: async (fn) => fn(repo)
  });
  return { app, repo, store, released };
}

export async function tokenFor(app, username = 'admin', password = PASSWORD) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  return res.body.token;
}
