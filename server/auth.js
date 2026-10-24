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
    { sub: admin.id, username: admin.username, tv: admin.token_version },
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
