import pg from 'pg';
import { loadEnv } from './env.js';

const { Pool } = pg;

// One connection per serverless instance is enough (Node functions handle a
// single request at a time) and keeps Neon from exhausting its connection cap.
const POOL_CONFIG = {
  max: Number(process.env.DB_POOL_MAX || 1),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
  ssl: { rejectUnauthorized: true }
};

let pooled = null;

/** The pool always verifies the certificate itself, so an `sslmode` in the string
    is dropped: pg-connection-string warns that `require` silently aliases
    `verify-full` and will change meaning in a future major. */
function withoutSslMode(raw) {
  return raw
    .replace(/([?&])(?:sslmode|uselibpqcompat)=[^&#]*/gi, '$1')
    .replace(/&&+/g, '&')
    .replace(/\?&/, '?')
    .replace(/[?&]+$/, '');
}

export function getPool(databaseUrl = loadEnv().databaseUrl) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.');
  }
  if (!pooled) {
    pooled = new Pool({ connectionString: withoutSslMode(databaseUrl), ...POOL_CONFIG });
    pooled.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pooled;
}

export async function closePool() {
  if (pooled) {
    await pooled.end();
    pooled = null;
  }
}

/** Thin wrapper so every data access goes through one instrumented place. */
export function createDb(databaseUrl) {
  const pool = getPool(databaseUrl);
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  };
}
