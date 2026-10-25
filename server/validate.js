import { z } from 'zod';
import { badRequest } from './errors.js';
import { PERMISSIONS } from './permissions.js';
import { MEDIA_REF_PREFIX, isMediaRef } from './media.js';
import { articleBodyError } from './blocks.js';
import { SLUG_PATTERN } from './repo.js';

const TEXT_MAX = 4000;
const URL_MAX = 600;

const requiredText = (max = 200) =>
  z.string().trim().min(1, 'این فیلد ضروری است').max(max);

const optionalText = (max = TEXT_MAX) => z.string().trim().max(max).default('');

/**
 * Two shapes are accepted for a picture: an absolute HTTPS URL (a legacy
 * external asset) and `/api/media/<id>` — the path the API itself serves the
 * stored bytes from. `javascript:`/`data:` payloads are rejected by both tests,
 * and the relative form is what keeps an image working after the domain changes.
 */
export { MEDIA_REF_PREFIX };

const isStorableImageValue = (v) => /^https:\/\//i.test(v) || isMediaRef(v);

export function isStorableImage(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return true;
  if (v.length > URL_MAX) return false;
  return isStorableImageValue(v);
}

const imageUrl = z
  .string()
  .trim()
  .default('')
  .refine(isStorableImage, {
    message: 'تصویر باید یک آدرس HTTPS معتبر یا مسیر /api/media/… باشد'
  });

/** The id of the stored bytes; any external string is kept only as a reference. */
const publicId = z.string().trim().max(300).default('');

/**
 * Optional social profile link. Same reasoning as imageUrl: an empty value hides
 * the icon, anything else has to be a plain https address so a `javascript:`
 * string can never become an href on the public page.
 */
const profileUrl = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || (/^https:\/\//i.test(v) && v.length <= URL_MAX), {
    message: 'آدرس باید با https:// شروع شود یا خالی بماند'
  });

const year = z.coerce.number().int().min(1900).max(2100);
const publisher = z.enum(['Marvel', 'DC']);
const rating = z.coerce.number().min(0).max(10);

/**
 * The long-form text living on an item's own page. It is not trimmed to
 * requiredText because a record may legitimately exist before its page is
 * written — the card shows `desc`, the page shows `body`.
 */
const bodyText = z.string().max(60_000).default('');

/**
 * An article body additionally carries the picture lines the panel places
 * between paragraphs. The address in one of those lines becomes an `<img src>`
 * on a public page, so it is checked here and never trusted from the browser.
 */
const articleBody = bodyText.superRefine((value, issue) => {
  const problem = articleBodyError(value);
  if (problem) issue.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

/**
 * Empty means "make one for me": repo.js derives the address from the English
 * title and adds a counter if it is taken, so the panel can leave this blank and
 * still get a shareable link.
 */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(90)
  .default('')
  .refine((v) => v === '' || SLUG_PATTERN.test(v), {
    message: 'آدرس فقط حرف کوچک، رقم و خط تیره باشد (مثلاً spider-man-homecoming)'
  });

/**
 * An outgoing link on a page: where to watch a film, where to download a comic.
 * http is allowed next to https because plenty of streaming links are still
 * plain http; the scheme check is what keeps a `javascript:` string out of an
 * anchor.
 */
const optionalLink = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || (/^https?:\/\//i.test(v) && v.length <= URL_MAX), {
    message: 'لینک باید با http:// یا https:// شروع شود یا خالی بماند'
  });

export const comicSchema = z
  .object({
    title_fa: requiredText(),
    title_en: requiredText(),
    publisher,
    year,
    desc_fa: optionalText(),
    desc_en: optionalText(),
    body_fa: bodyText,
    body_en: bodyText,
    slug,
    downloadUrl: optionalLink,
    image: imageUrl,
    imagePublicId: publicId
  })
  // The panel speaks camelCase like the rest of the wire shape; the column is snake.
  .transform(({ downloadUrl: link, ...rest }) => ({ ...rest, download_url: link }));

export const articleSchema = z
  .object({
    title_fa: requiredText(),
    title_en: requiredText(),
    cat: z.enum(['marvel', 'dc', 'movies', 'characters', 'comics', 'news']),
    date_fa: requiredText(80),
    date_en: requiredText(80),
    desc_fa: optionalText(),
    desc_en: optionalText(),
    body_fa: articleBody,
    body_en: articleBody,
    slug,
    coverImage: imageUrl,
    coverImagePublicId: publicId,
    midImage: imageUrl,
    midImagePublicId: publicId,
    lateImage: imageUrl,
    lateImagePublicId: publicId
  })
  .transform(({ cat, ...rest }) => ({ category: cat, ...rest }));

export const movieSchema = z
  .object({
    name_fa: requiredText(),
    name_en: requiredText(),
    universe: publisher,
    year,
    rating,
    desc_fa: optionalText(),
    desc_en: optionalText(),
    body_fa: bodyText,
    body_en: bodyText,
    slug,
    watchUrl: optionalLink,
    image: imageUrl,
    imagePublicId: publicId
  })
  // The panel speaks camelCase like the rest of the wire shape; the column is snake.
  .transform(({ watchUrl: link, ...rest }) => ({ ...rest, watch_url: link }));

export const characterSchema = z
  .object({
    name_fa: requiredText(),
    name_en: requiredText(),
    universe: publisher,
    type: z.enum(['hero', 'villain']),
    desc_fa: optionalText(),
    desc_en: optionalText(),
    body_fa: bodyText,
    body_en: bodyText,
    slug,
    image: imageUrl,
    imagePublicId: publicId
  })
  .transform(({ type, ...rest }) => ({ kind: type, ...rest }));

export const teamSchema = z.object({
  name_fa: requiredText(),
  name_en: requiredText(),
  role_fa: requiredText(120),
  role_en: requiredText(120),
  initials: z.string().trim().min(1).max(6),
  desc_fa: optionalText(),
  desc_en: optionalText(),
  image: imageUrl,
  imagePublicId: publicId
});

export const siteSchema = z.object({
  heroTitle: requiredText(120),
  heroSub_fa: optionalText(500),
  heroSub_en: optionalText(500),
  heroDesc_fa: optionalText(TEXT_MAX),
  heroDesc_en: optionalText(TEXT_MAX),
  aboutText_fa: optionalText(TEXT_MAX),
  aboutText_en: optionalText(TEXT_MAX),
  btn1_fa: optionalText(120),
  btn1_en: optionalText(120),
  btn2_fa: optionalText(120),
  btn2_en: optionalText(120),
  socialX: profileUrl,
  socialInstagram: profileUrl,
  socialYoutube: profileUrl,
  socialDiscord: profileUrl
}).transform((s) => ({
  hero_title: s.heroTitle,
  hero_sub_fa: s.heroSub_fa,
  hero_sub_en: s.heroSub_en,
  hero_desc_fa: s.heroDesc_fa,
  hero_desc_en: s.heroDesc_en,
  about_fa: s.aboutText_fa,
  about_en: s.aboutText_en,
  btn1_fa: s.btn1_fa,
  btn1_en: s.btn1_en,
  btn2_fa: s.btn2_fa,
  btn2_en: s.btn2_en,
  social_x: s.socialX,
  social_instagram: s.socialInstagram,
  social_youtube: s.socialYoutube,
  social_discord: s.socialDiscord
}));

/**
 * The contact form's anti-automation fields. `website` is a honeypot — it is
 * hidden from people by CSS and filled only by a bot that parses the markup, and
 * a submission containing it is dropped without saying why. The two challenge
 * fields carry the answer and the signed token from /api/challenge; routes.js
 * checks them because that needs the secret and the client IP.
 */
export const contactSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().email().max(200),
  subject: requiredText(200),
  message: requiredText(4000),
  website: z.string().max(0).default(''),
  challenge: z.string().trim().max(400).default(''),
  answer: z.string().trim().max(20).default(''),
  turnstile: z.string().trim().max(2000).default('')
});

export const newsletterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200)
});

export const loginSchema = z.object({
  username: requiredText(60).transform((v) => v.toLowerCase()),
  password: requiredText(200)
});

/**
 * Reader accounts. One login field takes either the username or the email, so the
 * form does not have to ask which one was used at signup; the lookup in repo.js
 * matches both. Passwords are a notch shorter than an admin's on purpose — this
 * account unlocks articles, not the panel.
 */
const memberUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'نام کاربری ۳ تا ۳۲ نویسه و فقط حروف کوچک، رقم، نقطه، خط تیره یا آندرلاین');

const memberPassword = z.string().min(8, 'رمز عبور حداقل ۸ کاراکتر').max(200);

/** Optional, but never junk: an address is a unique index in the database. */
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'ایمیل معتبر نیست' })
  .default('');

export const memberSignupSchema = z.object({
  username: memberUsername,
  email: optionalEmail,
  password: memberPassword,
  display_name: optionalText(80),
  website: z.string().max(0).default(''),
  challenge: z.string().trim().max(400).default(''),
  answer: z.string().trim().max(20).default(''),
  turnstile: z.string().trim().max(2000).default('')
});

export const memberLoginSchema = z.object({
  login: requiredText(120).transform((v) => v.toLowerCase()),
  password: requiredText(200)
});

/** A reader changing their own password has to prove the old one. */
export const memberPasswordSchema = z.object({
  current_password: requiredText(200),
  new_password: memberPassword
});

/** What an admin may change on a member account; the password has its own call. */
export const memberProfileSchema = z.object({
  display_name: requiredText(80),
  email: optionalEmail,
  is_active: z.boolean().default(true)
});

export const memberResetSchema = z.object({ password: memberPassword });

export const changePasswordSchema = z.object({
  current_password: requiredText(200),
  new_password: z.string().min(10, 'رمز جدید حداقل ۱۰ کاراکتر').max(200)
});

const MIN_PASSWORD = 10;

const adminUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'نام کاربری ۳ تا ۳۲ نویسه و فقط حروف کوچک، رقم، نقطه، خط تیره یا آندرلاین');

const adminPassword = z.string().min(MIN_PASSWORD, `رمز عبور حداقل ${MIN_PASSWORD} کاراکتر`).max(200);

const permissionKeys = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

export const createAdminSchema = z.object({
  username: adminUsername,
  display_name: requiredText(80),
  password: adminPassword,
  permissions: permissionKeys.default([])
});

export const adminProfileSchema = z.object({
  display_name: requiredText(80),
  permissions: permissionKeys.default([]),
  is_active: z.boolean().default(true)
});

export const adminPasswordSchema = z.object({ password: adminPassword });

export const entitySchemas = {
  comic: comicSchema,
  article: articleSchema,
  movie: movieSchema,
  character: characterSchema,
  team: teamSchema
};

/** Maps the panel's plural page names onto entity types. */
/** Validated, database-shaped input for one entity. Throws a 400 ApiError. */
export function parseEntityInput(type, raw) {
  const parsed = entitySchemas[type].safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      'لطفاً فیلدها را بررسی کنید',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message
      }))
    );
  }
  return parsed.data;
}
