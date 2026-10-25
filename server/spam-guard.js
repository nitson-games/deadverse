import crypto from 'node:crypto';

/**
 * Two defences share this module and the site uses whichever the deployment
 * configures:
 *
 *  - Cloudflare Turnstile, when TURNSTILE_SITEKEY/SECRET are set. Real bot
 *    filtering, no maths on screen.
 *  - a signed arithmetic challenge, when they are not. The answer never travels
 *    inside the token; the token is an HMAC over the numbers plus the issuing IP,
 *    so it cannot be minted at the browser, reused from another machine, or kept
 *    alive past its window.
 *
 * A honeypot field and the message rules in routes.js (cooldown + identical text)
 * sit on top of either one — a human typing a message in a form should never feel
 * any of this, and a script that posts JSON does.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const MAX_AGE_MS = 15 * 60_000;

const toPersian = (n) => String(n).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);

/** Accepts ۱۲, 12 and everything between, because the keyboard is not under our control. */
export function normalizeAnswer(value) {
  const latin = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
  if (!/^-?\d{1,4}$/.test(latin)) return null;
  return Number(latin);
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('base64url').slice(0, 16);
}

export function createChallenge(secret, ip) {
  const multiply = crypto.randomInt(0, 2) === 1;
  const a = crypto.randomInt(multiply ? 2 : 7, multiply ? 6 : 40);
  const b = crypto.randomInt(multiply ? 2 : 3, multiply ? 6 : 30);
  const answer = multiply ? a * b : a + b;
  const payload = Buffer.from(
    JSON.stringify({ a, b, m: multiply ? 1 : 0, i: hashIp(ip), t: Date.now() })
  ).toString('base64url');
  return {
    token: `${payload}.${sign(payload, secret)}`,
    question: `${toPersian(a)} ${multiply ? '×' : '+'} ${toPersian(b)} = ؟`,
    hint_fa: 'جواب را فقط عدد بنویسید',
    hint_en: 'answer with the number only'
  };
}

export function verifyChallenge(token, answer, secret, ip) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = sign(payload, secret);
  const given = Buffer.from(String(signature));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (Date.now() - Number(data.t) > MAX_AGE_MS) return false;
  if (data.i !== hashIp(ip)) return false;
  const numeric = normalizeAnswer(answer);
  if (numeric === null) return false;
  return numeric === (data.m ? data.a * data.b : data.a + data.b);
}

/**
 * The siteverify call is a network round-trip, so a timeout is a rejection, not a
 * pass — otherwise a slow Cloudflare would silently open the form to everyone.
 */
export async function verifyTurnstile({ secret, token, remoteip }) {
  if (!secret || !token) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: String(token), remoteip: String(remoteip || '') })
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function challengeIsConfigured(env) {
  return Boolean(env.jwtSecret);
}
