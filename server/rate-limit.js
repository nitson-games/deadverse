/**
 * Fixed-window limiter held in the instance's memory. On serverless it is a
 * best-effort brake against bursts rather than a global guarantee, which is the
 * right trade for a free tier — brute-force attempts get slowed, honest traffic
 * is untouched.
 */
const buckets = new Map();

function clientKey(req, name) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = String(forwarded).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  return `${name}:${ip}`;
}

export function rateLimit({ name, limit = 10, windowMs = 60_000, message = 'too many requests' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req, name);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: { code: 'rate_limited', message } });
    }
    return next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();
