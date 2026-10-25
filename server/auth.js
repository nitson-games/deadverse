import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 11;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function signToken(admin, { secret, ttl }) {
  return jwt.sign(
    { sub: admin.id, kind: 'admin', username: admin.username, tv: admin.token_version },
    secret,
    { expiresIn: ttl, algorithm: 'HS256' }
  );
}

/**
 * Reader tokens are a different kind of credential, and the `kind` claim is what
 * keeps them apart: an admin route refuses anything that is not an admin token,
 * so a signed-up reader cannot walk into the panel with the same secret.
 */
export function signMemberToken(member, { secret, ttl }) {
  return jwt.sign(
    { sub: member.id, kind: 'member', username: member.username, tv: member.token_version },
    secret,
    { expiresIn: ttl, algorithm: 'HS256' }
  );
}

export function verifyToken(token, secret) {
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

export function bearerFrom(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}
