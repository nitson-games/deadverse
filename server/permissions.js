/**
 * Permission keys are the contract between the API, the panel and the database.
 * Adding a key here is enough to make it assignable; routes opt in explicitly.
 */
export const PERMISSIONS = [
  'content',
  'team',
  'messages',
  'newsletter',
  'members',
  'site',
  'backup',
  'admins'
];

export const PERMISSION_LABELS = {
  content: 'محتوا (کمیک، مقاله، فیلم، شخصیت)',
  team: 'بخش تیم سایت',
  messages: 'پیام‌های تماس',
  newsletter: 'مشترک‌های خبرنامه',
  members: 'عضوهای سایت (فهرست، غیرفعال‌کردن، حذف)',
  site: 'تنظیمات سایت',
  backup: 'پشتیبان‌گیری و بازنشانی داده‌ها',
  admins: 'مدیریت ادمین‌ها و دسترسی‌ها'
};

export const ALL_PERMISSIONS = [...PERMISSIONS];

/** De-duplicates, drops unknown keys and keeps the canonical order. */
export function normalizePermissions(list) {
  if (!Array.isArray(list)) return [];
  const given = new Set(list.map((key) => String(key).trim()));
  return PERMISSIONS.filter((key) => given.has(key));
}

export function hasPermission(admin, key) {
  if (!admin || admin.is_active === false) return false;
  if (!Array.isArray(admin.permissions)) return false;
  return admin.permissions.includes(key);
}

/** Admins who can still manage the panel — used to block lockout. */
export function canManageAdmins(admin) {
  return hasPermission(admin, 'admins');
}
