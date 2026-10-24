import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || '',
    tokenTtl: process.env.JWT_EXPIRES_IN || '12h',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bootstrapAdmin: {
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || ''
    },
    nodeEnv: process.env.NODE_ENV || 'development'
  };
}

export function assertProductionEnv(env = loadEnv()) {
  const missing = [];
  if (!env.databaseUrl) missing.push('DATABASE_URL');
  if (!env.jwtSecret || env.jwtSecret === 'dev-only-secret-change-me') missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return env;
}

export const schemaSqlPath = path.join(__dirname, 'schema.sql');
export const readSchemaSql = () => fs.readFileSync(schemaSqlPath, 'utf8');
