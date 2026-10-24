import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function id(prefix) {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}${Date.now().toString(36)}${out}`;
}

export const ID_PREFIX = {
  admin: 'ad_',
  comic: 'cm_',
  article: 'ar_',
  movie: 'mv_',
  character: 'ch_',
  team: 'tm_',
  message: 'ms_',
  subscriber: 'ns_',
  media: 'md_'
};
