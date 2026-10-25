import { Router } from 'express';
import { ApiError, badRequest, conflict, h, notFound, unauthorized } from './errors.js';
import {
  parseEntityInput,
  siteSchema,
  contactSchema,
  newsletterSchema,
  loginSchema,
  changePasswordSchema,
  memberLoginSchema,
  memberPasswordSchema,
  memberProfileSchema,
  memberResetSchema,
  memberSignupSchema
} from './validate.js';
import { hashPassword, signMemberToken, signToken, verifyPassword } from './auth.js';
import { createChallenge, verifyChallenge, verifyTurnstile } from './spam-guard.js';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  hasPermission,
  normalizePermissions
} from './permissions.js';
import { adminPasswordSchema, adminProfileSchema, createAdminSchema, isStorableImage, MEDIA_REF_PREFIX } from './validate.js';
import { ENTITIES } from './repo.js';
import { id, ID_PREFIX } from './ids.js';
import { MAX_MEDIA_BYTES, MEDIA_ID_PATTERN, detectImageType } from './media.js';
import { SEEDS, SITE_SEED, EMPTY_SITE_CLIENT, seedInputs } from './seed.js';

const COLLECTIONS = {
  comics: 'comic',
  articles: 'article',
  movies: 'movie',
  characters: 'character',
  team: 'team'
};

/** The four kinds that own a page, keyed by the URL segment the site uses. */
const ITEM_COLLECTIONS = {
  comics: 'comic',
  articles: 'article',
  movies: 'movie',
  characters: 'character'
};

/** Reading these pages takes a member account; the rest of the site stays open. */
const MEMBER_ONLY = new Set(['article']);

export { SEEDS, SITE_SEED };

/** Vercel hands the real client address in x-forwarded-for; the first entry is
    the visitor, the rest is the proxy chain. */
function ipOf(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/**
 * The card shape the homepage needs. `body` lives only on the item page, and for
 * articles that page is behind a login — so it never travels inside bootstrap,
 * which is cached publicly for 20 seconds.
 */
function toCard(item) {
  const { body_fa, body_en, ...card } = item;
  return card;
}

/** `password_hash` and `token_version` must never leave the API. */
function publicMember(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    display_name: row.display_name,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at || null
  };
}

function validationError(error) {
  return badRequest(
    'لطفاً فیلدها را بررسی کنید',
    error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }))
  );
}

/**
 * A stored picture is released when its slot now holds a different URL (or none).
 * Comparing URLs rather than ids means an edit that never re-uploaded cannot
 * accidentally delete the image still on screen.
 */
function releasedMediaIds(type, oldRow, nextInput) {
  const released = [];
  for (const image of ENTITIES[type].images) {
    const previousPid = oldRow?.[image.pid] || '';
    const previousUrl = oldRow?.[image.url] || '';
    const nextUrl = nextInput[image.input] || '';
    if (previousPid && previousUrl !== nextUrl) released.push(previousPid);
  }
  return released;
}

/** Keep the stored media id when the picture itself was not replaced. */
function carryOverPids(type, oldRow, input) {
  for (const image of ENTITIES[type].images) {
    if (!input[image.pidInput] && input[image.input] && input[image.input] === oldRow[image.url]) {
      input[image.pidInput] = oldRow[image.pid];
    }
  }
  return input;
}

export function buildRoutes(ctx) {
  const { repo, env } = ctx;
  const router = Router();

  const requireAdmin = h(async (req, res, next) => {
    const admin = await ctx.getAdminFromRequest(req);
    if (!admin) throw unauthorized('برای این کار باید وارد شوید');
    req.admin = admin;
    return next();
  });

  /** Same as requireAdmin, plus one permission key. Runs on every request, so
      revoking a permission logs that account out of the affected pages at once. */
  const requirePermission = (permission) =>
    h(async (req, res, next) => {
      const admin = await ctx.getAdminFromRequest(req);
      if (!admin) throw unauthorized('برای این کار باید وارد شوید');
      req.admin = admin;
      if (!hasPermission(admin, permission)) {
        throw new ApiError(403, 'forbidden', `دسترسی «${permission}» برای حساب شما فعال نیست`);
      }
      return next();
    });

  /** Readers are a separate account kind; only the gated article pages use this. */
  const requireMember = h(async (req, res, next) => {
    const member = await ctx.getMemberFromRequest(req);
    if (!member) throw unauthorized('برای خواندن این صفحه عضو شوید');
    req.member = member;
    return next();
  });

  /**
   * Everything that stands between a script and the inbox. Order matters: the
   * honeypot is answered first and answered *quietly*, because telling a bot it
   * was caught only teaches it to fill the field with a space.
   */
  async function spamGate(req) {
    const body = req.body || {};
    if (String(body.website || '').length > 0) return { dropped: true };

    if (env.turnstile.siteKey && env.turnstile.secret) {
      const ok = await verifyTurnstile({
        secret: env.turnstile.secret,
        token: body.turnstile,
        remoteip: ipOf(req)
      });
      if (!ok) throw badRequest('راستی‌آزمایی انجام نشد، دوباره امتحان کنید');
      return { dropped: false, method: 'turnstile' };
    }

    if (!verifyChallenge(body.challenge, body.answer, env.jwtSecret, ipOf(req))) {
      throw badRequest('جواب سوال درست نبود یا وقتش تمام شده؛ دوباره بپرسید');
    }
    return { dropped: false, method: 'challenge' };
  }

  // --------------------------------------------------------------- public API
  router.get('/health', (req, res) => {
    res.json({ ok: true, service: 'deadverse-api', time: new Date().toISOString() });
  });

  router.get(
    '/bootstrap',
    h(async (req, res) => {
      const [comics, articles, movies, characters, team, site] = await Promise.all([
        repo.list('comic'),
        repo.list('article'),
        repo.list('movie'),
        repo.list('character'),
        repo.list('team'),
        repo.getSite()
      ]);
      res.set('Cache-Control', 'public, max-age=20, must-revalidate');
      res.json({
        site: site || EMPTY_SITE_CLIENT,
        comics: comics.map(toCard),
        articles: articles.map(toCard),
        movies: movies.map(toCard),
        characters: characters.map(toCard),
        team
      });
    })
  );

  // ---------------------------------------------------- public pages per item
  /**
   * One page per record at /comics/<slug> and friends. The lookup takes the slug
   * first and falls back to the id, so an admin previewing a brand-new record
   * still gets a working link before its slug is shared anywhere.
   */
  for (const [segment, type] of Object.entries(ITEM_COLLECTIONS)) {
    const gate = MEMBER_ONLY.has(type) ? [requireMember] : [];
    router.get(
      `/${segment}/:slug`,
      ...gate,
      h(async (req, res) => {
        const slug = String(req.params.slug || '').trim();
        if (!slug) throw notFound('این صفحه وجود ندارد');
        const item = (await repo.findBySlug(type, slug)) || (await repo.find(type, slug));
        if (!item) throw notFound('این صفحه وجود ندارد یا حذف شده است');
        res.set('Cache-Control', MEMBER_ONLY.has(type) ? 'no-store' : 'public, max-age=20, must-revalidate');
        res.json(item);
      })
    );
  }

  router.get(
    '/challenge',
    ctx.limiter.challenge,
    h(async (req, res) => {
      if (!env.jwtSecret) throw new ApiError(503, 'not_configured', 'راستی‌آزمایی فعلاً در دسترس نیست');
      res.set('Cache-Control', 'no-store');
      res.json({
        ...createChallenge(env.jwtSecret, ipOf(req)),
        // The page shows the maths question only when no Turnstile widget is set up.
        turnstile_sitekey: env.turnstile.siteKey || ''
      });
    })
  );

  /** The bytes live in the same Postgres cluster as the text; this is the CDN
      edge in front of them. Ids never change content, so the browser answer is
      immutable — but the edge TTL stays short on purpose: deleting an item
      frees its bytes immediately, and a year-long edge copy would keep serving
      an image that no longer belongs to anything. */
  router.get(
    '/media/:id',
    h(async (req, res) => {
      if (!MEDIA_ID_PATTERN.test(req.params.id)) throw notFound('تصویر پیدا نشد');
      const row = await repo.getMedia(req.params.id);
      if (!row) throw notFound('تصویر پیدا نشد');
      const etag = `"${req.params.id}-${row.bytes}"`;
      res.set('Content-Type', row.content_type);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Vercel-CDN-Cache-Control', 'public, s-maxage=3600');
      res.set('ETag', etag);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.send(row.data);
    })
  );

  router.post(
    '/contact',
    ctx.limiter.contact,
    h(async (req, res) => {
      const gate = await spamGate(req);
      // A honeypot hit answers as if it worked, and stores nothing.
      if (gate.dropped) return res.status(201).json({ ok: true });

      const parsed = contactSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);

      const cooldownMs = Math.max(0, env.contactCooldownMinutes) * 60_000;
      if (cooldownMs > 0) {
        const last = await repo.lastMessageAt(parsed.data.email);
        const waited = last ? Date.now() - new Date(last).getTime() : cooldownMs + 1;
        if (waited < cooldownMs) {
          const minutes = Math.ceil((cooldownMs - waited) / 60_000);
          throw new ApiError(
            429,
            'cooldown',
            `شما تازه پیام فرستاده‌اید؛ ${minutes} دقیقه دیگر دوباره امتحان کنید`
          );
        }
      }
      if (await repo.messageIsDuplicate(parsed.data)) {
        throw badRequest('این متن را همین چند وقت پیش فرستاده‌اید');
      }

      const inserted = await repo.insertMessage(parsed.data);
      res.status(201).json({ ok: true, id: inserted });
    })
  );

  router.post(
    '/newsletter',
    ctx.limiter.newsletter,
    h(async (req, res) => {
      const parsed = newsletterSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('ایمیل معتبر نیست');
      const result = await repo.subscribe(parsed.data.email);
      res.status(result.created ? 201 : 200).json({ ok: true, already_subscribed: !result.created });
    })
  );

  // ---------------------------------------------------------- member accounts
  /** The token is what unlocks the article pages; the profile is what the header shows. */
  const memberAnswer = (req, res, member, status) => {
    if (status) res.status(status);
    res.json({
      token: signMemberToken(member, { secret: env.jwtSecret, ttl: env.memberTokenTtl }),
      member: publicMember(member)
    });
  };

  router.post(
    '/member/signup',
    ctx.limiter.signup,
    h(async (req, res) => {
      // Same order as /contact: the honeypot is answered before the payload is
      // examined, so a bot that filled it is dropped instead of taught.
      const gate = await spamGate(req);
      if (gate.dropped) return res.status(201).json({ ok: true });

      const parsed = memberSignupSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);

      const { username, email } = parsed.data;
      if (await repo.findMemberByLogin(username)) {
        throw conflict('این نام کاربری از قبل گرفته شده است');
      }
      if (email && (await repo.findMemberByLogin(email))) {
        throw conflict('این ایمیل از قبل روی یک حساب دیگر ثبت شده است');
      }
      const member = await repo.createMember({
        username,
        email,
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.display_name || username
      });
      memberAnswer(req, res, member, 201);
    })
  );

  router.post(
    '/member/login',
    ctx.limiter.memberLogin,
    h(async (req, res) => {
      const parsed = memberLoginSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('نام کاربری و رمز عبور لازم است');
      const member = await repo.findMemberByLogin(parsed.data.login);
      const passwordOk = member ? await verifyPassword(parsed.data.password, member.password_hash) : false;
      // Same words either way, and the hash is still compared when the account is
      // disabled, so the response never reveals which usernames exist.
      if (!passwordOk) throw unauthorized('نام کاربری یا رمز عبور اشتباه است');
      if (member.is_active === false) throw unauthorized('این حساب غیرفعال شده است');
      await repo.touchMember(member.id);
      memberAnswer(req, res, member);
    })
  );

  router.get(
    '/member/session',
    requireMember,
    h(async (req, res) => {
      // Hitting this route is the proof a member is actually reading, so the panel
      // can tell an account that logs in weekly from one that was made and forgotten.
      const seen = (await repo.touchMember(req.member.id)) || req.member;
      res.json({ member: publicMember(seen) });
    })
  );

  router.patch(
    '/member/password',
    requireMember,
    ctx.limiter.memberLogin,
    h(async (req, res) => {
      const parsed = memberPasswordSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      if (!(await verifyPassword(parsed.data.current_password, req.member.password_hash))) {
        throw badRequest('رمز فعلی اشتباه است');
      }
      await repo.updateMemberPassword(req.member.id, await hashPassword(parsed.data.new_password));
      res.json({ ok: true, message: 'رمز عوض شد؛ همه‌ی دستگاه‌ها باید دوباره وارد شوند' });
    })
  );

  /** Deleting your own account is the one thing a reader should never have to ask for. */
  router.delete('/member/account', requireMember, h(async (req, res) => {
    if (!(await repo.deleteMember(req.member.id))) throw notFound('حساب پیدا نشد');
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------- admin: auth
  router.post(
    '/admin/login',
    ctx.limiter.login,
    h(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('نام کاربری و رمز عبور لازم است');
      const admin = await repo.findAdminByUsername(parsed.data.username);
      const passwordOk = admin ? await verifyPassword(parsed.data.password, admin.password_hash) : false;
      if (!passwordOk) throw unauthorized('نام کاربری یا رمز عبور اشتباه است');
      if (admin.is_active === false) throw unauthorized('این حساب غیرفعال شده است');
      const token = signToken(admin, { secret: env.jwtSecret, ttl: env.tokenTtl });
      res.json({
        token,
        username: admin.username,
        displayName: admin.display_name,
        permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
        permissionLabels: PERMISSION_LABELS
      });
    })
  );

  router.get('/admin/session', requireAdmin, (req, res) => {
    res.json({
      username: req.admin.username,
      displayName: req.admin.display_name,
      permissions: Array.isArray(req.admin.permissions) ? req.admin.permissions : [],
      permissionLabels: PERMISSION_LABELS
    });
  });

  router.post(
    '/admin/change-password',
    requireAdmin,
    ctx.limiter.login,
    h(async (req, res) => {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      const currentOk = await verifyPassword(parsed.data.current_password, req.admin.password_hash);
      if (!currentOk) throw badRequest('رمز فعلی اشتباه است');
      await repo.updateAdminPassword(req.admin.id, await hashPassword(parsed.data.new_password));
      res.json({ ok: true, message: 'رمز تغییر کرد و همه نشست‌های قبلی باطل شدند' });
    })
  );

  // -------------------------------------------------------- admin: admin staff
  const canManageStaff = requirePermission('admins');

  /** Rows carry password_hash; nothing from that column may leave the API. */
  const publicAdmin = (row) => ({
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at
  });

  router.get('/admin/admins', canManageStaff, h(async (req, res) => {
    const rows = await repo.listAdmins();
    res.json({
      items: rows.map(publicAdmin),
      permissions: PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] }))
    });
  }));

  router.post(
    '/admin/admins',
    canManageStaff,
    ctx.limiter.login,
    h(async (req, res) => {
      const parsed = createAdminSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      if (await repo.findAdminByUsername(parsed.data.username)) {
        throw conflict('این نام کاربری از قبل استفاده شده است');
      }
      const created = await repo.createAdmin({
        username: parsed.data.username,
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.display_name,
        permissions: normalizePermissions(parsed.data.permissions)
      });
      res.status(201).json(publicAdmin(created));
    })
  );

  router.put('/admin/admins/:id', canManageStaff, h(async (req, res) => {
    const target = await repo.findAdminById(req.params.id);
    if (!target) throw notFound('این ادمین وجود ندارد یا حذف شده است');
    const parsed = adminProfileSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const permissions = normalizePermissions(parsed.data.permissions);
    const isSelf = req.admin.id === target.id;
    // Editing yourself could strip the very permission that lets you edit staff,
    // so account changes always go through another admin.
    if (isSelf && (parsed.data.is_active === false || permissions.join() !== normalizePermissions(req.admin.permissions).join())) {
      throw badRequest('دسترسی یا وضعیت حساب خودتان را نمی‌توانید تغییر دهید');
    }
    // The requester is an active admin holding this permission and cannot edit
    // their own row, so at least one manager always survives.
    const updated = await repo.updateAdminProfile(target.id, {
      displayName: parsed.data.display_name,
      permissions: isSelf ? (Array.isArray(target.permissions) ? target.permissions : []) : permissions,
      isActive: isSelf ? target.is_active !== false : parsed.data.is_active,
      logoutEverywhere: !isSelf
    });
    res.json(publicAdmin(updated));
  }));

  router.post(
    '/admin/admins/:id/password',
    canManageStaff,
    ctx.limiter.login,
    h(async (req, res) => {
      const target = await repo.findAdminById(req.params.id);
      if (!target) throw notFound('این ادمین وجود ندارد یا حذف شده است');
      const parsed = adminPasswordSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      if (req.admin.id === target.id) {
        throw badRequest('برای تغییر رمز خودتان از بخش «رمز عبور» و با رمز فعلی استفاده کنید');
      }
      await repo.updateAdminPassword(target.id, await hashPassword(parsed.data.password));
      res.json({ ok: true, message: 'رمز عوض شد و نشست‌های آن حساب باطل شد' });
    })
  );

  router.delete('/admin/admins/:id', canManageStaff, h(async (req, res) => {
    const target = await repo.findAdminById(req.params.id);
    if (!target) throw notFound('این ادمین وجود ندارد یا حذف شده است');
    if (req.admin.id === target.id) throw badRequest('حساب خودتان را نمی‌توانید حذف کنید');
    if (!(await repo.deleteAdmin(target.id))) throw notFound('این ادمین وجود ندارد یا حذف شده است');
    res.json({ ok: true });
  }));

  // ------------------------------------------------------ admin: collections
  const canContent = requirePermission('content');
  const canTeam = requirePermission('team');

  for (const [collection, type] of Object.entries(COLLECTIONS)) {
    // The team section has its own tick, so `content` no longer reaches it.
    const guard = type === 'team' ? canTeam : canContent;

    router.get(`/admin/${collection}`, guard, h(async (req, res) => {
      res.json(await repo.list(type));
    }));

    router.post(`/admin/${collection}`, guard, h(async (req, res) => {
      const input = parseEntityInput(type, req.body);
      res.status(201).json(await repo.create(type, input));
    }));

    router.put(`/admin/${collection}/:id`, guard, h(async (req, res) => {
      const input = parseEntityInput(type, req.body);
      const oldRow = await repo.findRaw(type, req.params.id);
      if (!oldRow) throw notFound('این مورد وجود ندارد یا حذف شده است');
      const updated = await repo.update(type, req.params.id, carryOverPids(type, oldRow, input));
      await ctx.releaseMedia(releasedMediaIds(type, oldRow, input));
      res.json(updated);
    }));

    router.delete(`/admin/${collection}/:id`, guard, h(async (req, res) => {
      const oldRow = await repo.findRaw(type, req.params.id);
      if (!oldRow) throw notFound('این مورد وجود ندارد یا حذف شده است');
      const removed = await repo.remove(type, req.params.id);
      await ctx.releaseMedia(ENTITIES[type].images.map((image) => oldRow[image.pid]).filter(Boolean));
      res.json({ ok: true, removed });
    }));
  }

  // --------------------------------------------------------- admin: members
  const canMembers = requirePermission('members');

  router.get('/admin/members', canMembers, h(async (req, res) => {
    const query = String(req.query?.q || '').slice(0, 80);
    res.json({
      items: await repo.listMembers({ query }),
      totals: await repo.countMembers()
    });
  }));

  /** Hand-built accounts, for the reader who mails you asking for access. */
  router.post(
    '/admin/members',
    canMembers,
    ctx.limiter.login,
    h(async (req, res) => {
      const parsed = memberSignupSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      if (await repo.findMemberByLogin(parsed.data.username)) {
        throw conflict('این نام کاربری از قبل گرفته شده است');
      }
      if (parsed.data.email && (await repo.findMemberByLogin(parsed.data.email))) {
        throw conflict('این ایمیل از قبل روی یک حساب دیگر ثبت شده است');
      }
      const member = await repo.createMember({
        username: parsed.data.username,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.display_name || parsed.data.username
      });
      res.status(201).json(publicMember(member));
    })
  );

  router.patch('/admin/members/:id', canMembers, h(async (req, res) => {
    const target = await repo.findMemberById(req.params.id);
    if (!target) throw notFound('این عضو وجود ندارد یا حذف شده است');
    const parsed = memberProfileSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data.email && parsed.data.email.toLowerCase() !== target.email) {
      const clash = await repo.findMemberByLogin(parsed.data.email);
      if (clash && clash.id !== target.id) throw conflict('این ایمیل روی یک حساب دیگر است');
    }
    const updated = await repo.updateMemberProfile(target.id, {
      displayName: parsed.data.display_name,
      email: parsed.data.email,
      isActive: parsed.data.is_active,
      // Switching an account off has to take effect on the page they are reading
      // right now, which only a bumped token_version does.
      logoutEverywhere: true
    });
    res.json(publicMember(updated));
  }));

  router.post(
    '/admin/members/:id/password',
    canMembers,
    ctx.limiter.login,
    h(async (req, res) => {
      const target = await repo.findMemberById(req.params.id);
      if (!target) throw notFound('این عضو وجود ندارد یا حذف شده است');
      const parsed = memberResetSchema.safeParse(req.body);
      if (!parsed.success) throw validationError(parsed.error);
      await repo.updateMemberPassword(target.id, await hashPassword(parsed.data.password));
      res.json({ ok: true, message: 'رمز عوض شد و نشست‌های آن حساب باطل شد' });
    })
  );

  router.delete('/admin/members/:id', canMembers, h(async (req, res) => {
    if (!(await repo.deleteMember(req.params.id))) throw notFound('این عضو وجود ندارد یا حذف شده است');
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------ admin: inbox
  const canMessages = requirePermission('messages');
  const canNewsletter = requirePermission('newsletter');

  router.get('/admin/messages', canMessages, h(async (req, res) => {
    res.json(await repo.listMessages());
  }));

  router.delete('/admin/messages', canMessages, h(async (req, res) => {
    res.json({ ok: true, deleted: await repo.clearMessages() });
  }));

  router.patch('/admin/messages/:id', canMessages, h(async (req, res) => {
    const ok = await repo.markMessageRead(req.params.id, Boolean(req.body?.is_read));
    if (!ok) throw notFound();
    res.json({ ok: true });
  }));

  router.delete('/admin/messages/:id', canMessages, h(async (req, res) => {
    if (!(await repo.deleteMessage(req.params.id))) throw notFound();
    res.json({ ok: true });
  }));

  router.get('/admin/subscribers', canNewsletter, h(async (req, res) => {
    res.json(await repo.listSubscribers());
  }));

  /** Removing an address is a real request people make (and the only way the
      newsletter list stays free of test rows). */
  router.delete('/admin/subscribers/:id', canNewsletter, h(async (req, res) => {
    const removed = await repo.deleteSubscriber(req.params.id);
    if (!removed) throw notFound();
    res.json({ ok: true, email: removed.email });
  }));

  // ----------------------------------------------------------- admin: settings
  const canSite = requirePermission('site');

  router.get('/admin/site', canSite, h(async (req, res) => {
    res.json((await repo.getSite()) || EMPTY_SITE_CLIENT);
  }));

  router.put('/admin/site', canSite, h(async (req, res) => {
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    res.json(await repo.saveSite(parsed.data));
  }));

  router.post(
    '/admin/site/reset',
    canSite,
    h(async (req, res) => {
      await repo.resetSite();
      await repo.saveSite(SITE_SEED);
      res.json(await repo.getSite());
    })
  );

  // -------------------------------------------------------------- admin: stats
  router.get('/admin/stats', requireAdmin, h(async (req, res) => {
    const [comics, articles, movies, characters, team, unread, subscribers, messages, media, members] =
      await Promise.all([
        repo.count('comic'),
        repo.count('article'),
        repo.count('movie'),
        repo.count('character'),
        repo.count('team'),
        repo.countUnreadMessages(),
        repo.countSubscribers(),
        repo.listMessages(1),
        repo.mediaUsage(),
        repo.countMembers()
      ]);
    res.json({
      comics,
      articles,
      movies,
      characters,
      team,
      unread,
      subscribers,
      members,
      mediaCount: media.count,
      mediaBytes: media.bytes,
      lastMessageAt: messages[0]?.created_at || null
    });
  }));

  // ------------------------------------------------------------- admin: media
  /** Raw binary body (see the express.raw mount in app.js) — no JSON envelope. */
  router.post('/admin/media', canContent, ctx.limiter.upload, h(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || !buffer.length) throw badRequest('بدنه‌ی درخواست خالی است');
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'تصویر بیش از ۴ مگابایت است');
    }
    const contentType = detectImageType(buffer);
    if (!contentType) {
      throw badRequest('فقط JPEG، PNG، GIF یا WebP قابل ذخیره است');
    }
    const mediaId = id(ID_PREFIX.media);
    await repo.insertMedia({
      id: mediaId,
      contentType,
      bytes: buffer.length,
      data: buffer
    });
    res.status(201).json({
      id: mediaId,
      url: `${MEDIA_REF_PREFIX}${mediaId}`,
      contentType,
      bytes: buffer.length
    });
  }));

  // ------------------------------------------------------- admin: backup pages
  const canBackup = requirePermission('backup');

  router.get('/admin/export', canBackup, h(async (req, res) => {
    const [comics, articles, movies, characters, team, messages, site] = await Promise.all([
      repo.list('comic'),
      repo.list('article'),
      repo.list('movie'),
      repo.list('character'),
      repo.list('team'),
      repo.listMessages(5000),
      repo.getSite()
    ]);
    res.set('Content-Disposition', 'attachment; filename="deadverse-backup.json"');
    res.json({
      version: 2,
      exportedAt: new Date().toISOString(),
      data: { comics, articles, movies, characters, team, messages, site }
    });
  }));

  router.post('/admin/import', canBackup, h(async (req, res) => {
    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
    const hasCollections = Object.keys(COLLECTIONS).some((key) => Array.isArray(payload?.[key]));
    if (!payload || typeof payload !== 'object' || !hasCollections) {
      throw badRequest('فایل پشتیبان معتبر نیست — هیچ لیستی در آن پیدا نشد');
    }

    const warnings = [];
    const imported = { comics: 0, articles: 0, movies: 0, characters: 0, team: 0, messages: 0 };

    await ctx.withTransaction(async (txRepo) => {
      for (const type of Object.values(COLLECTIONS)) await txRepo.clear(type);
      await txRepo.clearMessages();

      for (const [collection, type] of Object.entries(COLLECTIONS)) {
        for (const [index, raw] of (Array.isArray(payload[collection]) ? payload[collection] : []).entries()) {
          const candidate = { ...raw, sort_order: index };
          for (const image of ENTITIES[type].images) {
            const value = candidate[image.input];
            if (value && !isStorableImage(value)) {
              warnings.push(`${collection}[${index}]: تصویر «${image.input}» ذخیره نشد — فقط آدرس HTTPS یا مسیر /api/media/… مجاز است`);
            }
            const stored = isStorableImage(value) ? String(value || '').trim() : '';
            candidate[image.input] = stored;
            // A reference to our own stored bytes keeps its id, so deleting the
            // row later still frees the space.
            candidate[image.pidInput] = stored.startsWith(MEDIA_REF_PREFIX)
              ? stored.slice(MEDIA_REF_PREFIX.length)
              : '';
          }
          await txRepo.create(type, parseEntityInput(type, candidate));
          imported[collection] += 1;
        }
      }

      for (const message of Array.isArray(payload.messages) ? payload.messages : []) {
        const parsed = contactSchema.safeParse({
          name: message?.name,
          email: message?.email,
          subject: message?.subject,
          message: message?.message
        });
        if (!parsed.success) continue;
        await txRepo.insertMessage(parsed.data);
        imported.messages += 1;
      }

      if (payload.site) {
        const parsed = siteSchema.safeParse({ ...EMPTY_SITE_CLIENT, ...payload.site });
        if (parsed.success) await txRepo.saveSite(parsed.data);
        else warnings.push('site: تنظیمات نامعتبر بود و مقدار پیش‌فرض ماند');
      }
    });

    res.json({ ok: true, imported, warnings });
  }));

  router.post('/admin/reset', requireAdmin, h(async (req, res) => {
    await ctx.withTransaction(async (txRepo) => {
      for (const type of Object.keys(SEEDS)) {
        await txRepo.clear(type);
        for (const input of seedInputs(type)) {
          await txRepo.create(type, parseEntityInput(type, input));
        }
      }
      await txRepo.clearMessages();
      await txRepo.resetSite();
      await txRepo.saveSite(SITE_SEED);
      // The seeded content has no pictures, so every stored image would be dead weight.
      await txRepo.clearMedia();
    });
    res.json({ ok: true, message: 'همه داده‌ها به حالت پیش‌فرض بازنشانی شد' });
  }));

  return router;
}

export { COLLECTIONS };
