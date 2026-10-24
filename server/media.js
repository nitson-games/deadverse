/**
 * Images are stored as bytes in the same Postgres database as the content, so
 * the site needs no second account anywhere. The browser compresses before
 * uploading, which keeps a poster around 100-300 KB.
 */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
export const MEDIA_ID_PATTERN = /^md_[0-9a-z]+$/;

/**
 * The declared content-type is a client claim; the first bytes decide. Without
 * this an attacker could store HTML or a script and have the API serve it back
 * from the site's own origin.
 */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Ids that are ours; anything else (an external URL's id) must never be deleted. */
export function ownedMediaIds(ids) {
  return [...new Set((ids || []).filter((v) => typeof v === 'string' && MEDIA_ID_PATTERN.test(v)))];
}
