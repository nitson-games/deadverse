import { z } from 'zod';
import { badRequest } from './errors.js';
import { PERMISSIONS } from './permissions.js';

const TEXT_MAX = 4000;
const URL_MAX = 600;

const requiredText = (max = 200) =>
  z.string().trim().min(1, 'این فیلد ضروری است').max(max);

const optionalText = (max = TEXT_MAX) => z.string().trim().max(max).default('');

/**
 * Only HTTPS image URLs are accepted. This is what stops `javascript:`/`data:`
 * payloads from reaching the site, and keeps the old base64-in-database pattern
 * from coming back.
 */
const imageUrl = z
  .string()
  .trim()
  .default('')
  .refine((v) => v === '' || (/^https:\/\//i.test(v) && v.length <= URL_MAX), {
    message: 'تصویر باید یک آدرس HTTPS معتبر باشد'
  });

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

export const comicSchema = z.object({
  title_fa: requiredText(),
  title_en: requiredText(),
  publisher,
  year,
  desc_fa: optionalText(),
  desc_en: optionalText(),
  image: imageUrl,
  imagePublicId: publicId
});

export const articleSchema = z
  .object({
    title_fa: requiredText(),
    title_en: requiredText(),
    cat: z.enum(['marvel', 'dc', 'movies', 'characters', 'comics', 'news']),
    date_fa: requiredText(80),
    date_en: requiredText(80),
    desc_fa: optionalText(),
    desc_en: optionalText(),
    coverImage: imageUrl,
    coverImagePublicId: publicId,
    midImage: imageUrl,
    midImagePublicId: publicId,
    lateImage: imageUrl,
    lateImagePublicId: publicId
  })
  .transform(({ cat, ...rest }) => ({ category: cat, ...rest }));

export const movieSchema = z.object({
  name_fa: requiredText(),
  name_en: requiredText(),
  universe: publisher,
  year,
  rating,
  desc_fa: optionalText(),
  desc_en: optionalText(),
  image: imageUrl,
  imagePublicId: publicId
});

export const characterSchema = z
  .object({
    name_fa: requiredText(),
    name_en: requiredText(),
    universe: publisher,
    type: z.enum(['hero', 'villain']),
    desc_fa: optionalText(),
    desc_en: optionalText(),
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

export const contactSchema = z.object({
  name: requiredText(120),
  email: z.string().trim().toLowerCase().email().max(200),
  subject: requiredText(200),
  message: requiredText(4000)
});

export const newsletterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200)
});

export const loginSchema = z.object({
  username: requiredText(60).transform((v) => v.toLowerCase()),
  password: requiredText(200)
});

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
