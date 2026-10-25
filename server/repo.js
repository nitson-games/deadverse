import { ID_PREFIX, id } from './ids.js';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,90}$/;

/**
 * Transliterates the letters with no ASCII equivalent so a title typed in Persian
 * still produces a readable URL, then keeps only what a path segment may legally
 * contain. Everything outside the Latin alphabet is dropped by the cleanup below,
 * so an incomplete table costs a shorter slug, never a broken one.
 */
const PERSIAN_TO_LATIN = {
  'ق': 'q', 'ف': 'f', 'غ': 'gh', 'ک': 'k', 'ی': 'i', 'ي': 'i', 'ئ': 'y',
  'أ': 'a', 'إ': 'a', 'آ': 'aa', 'ى': 'a', 'ؤ': 'o', 'ة': 'h', 'ع': 'a',
  'ح': 'h', 'خ': 'kh', 'ث': 's', 'ذ': 'z', 'ض': 'd', 'ظ': 'z', 'ء': ''
};

export function slugify(value, fallback = '') {
  const transliterated = String(value || '')
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, (ch) => PERSIAN_TO_LATIN[ch] ?? '');
  const slug = transliterated
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/, '');
  return SLUG_PATTERN.test(slug) ? slug : (SLUG_PATTERN.test(fallback) ? fallback : 'item');
}

/**
 * Each entity declares its table, its column order for INSERT/UPDATE and how a
 * row becomes the object the frontend already knows how to render. Keeping the
 * wire shape identical to the old localStorage format means the panels need no
 * per-field translation layer.
 *
 * `hasSlug` marks the four kinds that own a page of their own; `hasBody` is the
 * long-form text that page shows below the summary card.
 */
const ENTITIES = {
  comic: {
    table: 'comics',
    prefix: ID_PREFIX.comic,
    hasSlug: true,
    fields: ['title_fa', 'title_en', 'publisher', 'year', 'desc_fa', 'desc_en', 'body_fa', 'body_en', 'slug', 'download_url'],
    images: [{ url: 'image_url', pid: 'image_public_id', input: 'image', pidInput: 'imagePublicId' }],
    bodies: ['body_fa', 'body_en'],
    slugSource: (values) => values.title_en || values.title_fa,
    toClient: (r) => ({
      id: r.id,
      slug: r.slug,
      title_fa: r.title_fa,
      title_en: r.title_en,
      publisher: r.publisher,
      year: Number(r.year),
      desc_fa: r.desc_fa,
      desc_en: r.desc_en,
      body_fa: r.body_fa,
      body_en: r.body_en,
      downloadUrl: r.download_url,
      image: r.image_url
    })
  },
  article: {
    table: 'articles',
    prefix: ID_PREFIX.article,
    hasSlug: true,
    fields: ['title_fa', 'title_en', 'category', 'date_fa', 'date_en', 'desc_fa', 'desc_en', 'body_fa', 'body_en', 'slug'],
    images: [
      { url: 'cover_image_url', pid: 'cover_image_pid', input: 'coverImage', pidInput: 'coverImagePublicId' },
      { url: 'mid_image_url', pid: 'mid_image_pid', input: 'midImage', pidInput: 'midImagePublicId' },
      { url: 'late_image_url', pid: 'late_image_pid', input: 'lateImage', pidInput: 'lateImagePublicId' }
    ],
    // The panel places pictures inside these two columns, so the bytes they
    // point at belong to the body, not to a fixed slot (see server/blocks.js).
    bodies: ['body_fa', 'body_en'],
    slugSource: (values) => values.title_en || values.title_fa,
    toClient: (r) => ({
      id: r.id,
      slug: r.slug,
      title_fa: r.title_fa,
      title_en: r.title_en,
      cat: r.category,
      date_fa: r.date_fa,
      date_en: r.date_en,
      desc_fa: r.desc_fa,
      desc_en: r.desc_en,
      body_fa: r.body_fa,
      body_en: r.body_en,
      coverImage: r.cover_image_url,
      midImage: r.mid_image_url,
      lateImage: r.late_image_url
    })
  },
  movie: {
    table: 'movies',
    prefix: ID_PREFIX.movie,
    hasSlug: true,
    fields: ['name_fa', 'name_en', 'universe', 'year', 'rating', 'desc_fa', 'desc_en', 'body_fa', 'body_en', 'slug', 'watch_url'],
    images: [{ url: 'image_url', pid: 'image_public_id', input: 'image', pidInput: 'imagePublicId' }],
    slugSource: (values) => values.name_en || values.name_fa,
    toClient: (r) => ({
      id: r.id,
      slug: r.slug,
      name_fa: r.name_fa,
      name_en: r.name_en,
      universe: r.universe,
      year: Number(r.year),
      rating: Number(r.rating),
      desc_fa: r.desc_fa,
      desc_en: r.desc_en,
      body_fa: r.body_fa,
      body_en: r.body_en,
      watchUrl: r.watch_url,
      image: r.image_url
    })
  },
  character: {
    table: 'characters',
    prefix: ID_PREFIX.character,
    hasSlug: true,
    fields: ['name_fa', 'name_en', 'universe', 'kind', 'desc_fa', 'desc_en', 'body_fa', 'body_en', 'slug'],
    images: [{ url: 'image_url', pid: 'image_public_id', input: 'image', pidInput: 'imagePublicId' }],
    slugSource: (values) => values.name_en || values.name_fa,
    toClient: (r) => ({
      id: r.id,
      slug: r.slug,
      name_fa: r.name_fa,
      name_en: r.name_en,
      universe: r.universe,
      type: r.kind,
      desc_fa: r.desc_fa,
      desc_en: r.desc_en,
      body_fa: r.body_fa,
      body_en: r.body_en,
      image: r.image_url
    })
  },
  team: {
    table: 'team_members',
    prefix: ID_PREFIX.team,
    fields: ['name_fa', 'name_en', 'role_fa', 'role_en', 'initials', 'desc_fa', 'desc_en'],
    images: [{ url: 'image_url', pid: 'image_public_id', input: 'image', pidInput: 'imagePublicId' }],
    toClient: (r) => ({
      id: r.id,
      name_fa: r.name_fa,
      name_en: r.name_en,
      role_fa: r.role_fa,
      role_en: r.role_en,
      initials: r.initials,
      desc_fa: r.desc_fa,
      desc_en: r.desc_en,
      image: r.image_url
    })
  }
};

export const ENTITY_TYPES = Object.keys(ENTITIES);

const ORDER_BY = 'ORDER BY sort_order ASC, created_at ASC, id ASC';

function columnValues(entity, data) {
  const values = {};
  for (const field of entity.fields) values[field] = data[field];
  for (const image of entity.images) {
    values[image.url] = data[image.input] || '';
    values[image.pid] = data[image.pidInput] || '';
  }
  return values;
}

export function makeRepo(db) {  function buildInsert(entity, newId, sortOrder, values, now) {
    const columns = ['id', 'sort_order', 'created_at', 'updated_at', ...Object.keys(values)];
    const params = [newId, sortOrder, now, now, ...Object.values(values)];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    return {
      text: `INSERT INTO ${entity.table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      params
    };
  }

  return {
    entities: ENTITIES,

    async list(type) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(`SELECT * FROM ${entity.table} ${ORDER_BY}`);
      return rows.map(entity.toClient);
    },

    async findRaw(type, itemId) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(`SELECT * FROM ${entity.table} WHERE id = $1`, [itemId]);
      return rows[0] || null;
    },

    async find(type, itemId) {
      const row = await this.findRaw(type, itemId);
      return row ? ENTITIES[type].toClient(row) : null;
    },

    async nextSortOrder(type) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${entity.table}`
      );
      return Number(rows[0].next);
    },

    /**
     * A slug is a public address, so two records may never share one. Rather than
     * failing the save when an admin writes the same English title twice, the
     * second row gets a counter suffix — the page still opens, just at -2.
     */
    async slugTaken(type, slug, exceptId = null) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(
        `SELECT id FROM ${entity.table} WHERE slug = $1 AND id <> $2 LIMIT 1`,
        [slug, exceptId || '']
      );
      return Boolean(rows[0]);
    },

    async allocateSlug(type, desired, exceptId = null) {
      const entity = ENTITIES[type];
      const base = slugify(desired, entity.prefix.replace(/_/g, ''));
      let candidate = base;
      for (let n = 2; await this.slugTaken(type, candidate, exceptId); n += 1) {
        candidate = `${base}-${n}`.slice(0, 90);
      }
      return candidate;
    },

    async findBySlug(type, slug) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(`SELECT * FROM ${entity.table} WHERE slug = $1 LIMIT 1`, [slug]);
      return rows[0] ? entity.toClient(rows[0]) : null;
    },

    /** Fills the empty slug left behind by an older row, so old content gets a page. */
    async backfillSlugs(type) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(
        `SELECT * FROM ${entity.table} WHERE slug = '' ORDER BY sort_order ASC, created_at ASC`
      );
      let filled = 0;
      for (const row of rows) {
        const client = entity.toClient(row);
        const slug = await this.allocateSlug(type, client.title_en || client.name_en || client.id, row.id);
        await db.query(`UPDATE ${entity.table} SET slug = $1 WHERE id = $2`, [slug, row.id]);
        filled += 1;
      }
      return filled;
    },

    async create(type, data) {
      const entity = ENTITIES[type];
      const now = new Date().toISOString();
      const newId = id(entity.prefix);
      const values = columnValues(entity, data);
      if (entity.hasSlug) {
        values.slug = await this.allocateSlug(type, values.slug || entity.slugSource(values));
      }
      const sortOrder = data.sort_order ?? (await this.nextSortOrder(type));
      const sql = buildInsert(entity, newId, sortOrder, values, now);
      const { rows } = await db.query(sql.text, sql.params);
      return entity.toClient(rows[0]);
    },

    async update(type, itemId, data) {
      const entity = ENTITIES[type];
      const values = columnValues(entity, data);
      if (entity.hasSlug) {
        if (!values.slug) {
          // Retitling must not move a page that is already linked or shared
          // somewhere; only an explicit address (or a record that never had one)
          // rewrites it.
          const current = await this.findRaw(type, itemId);
          values.slug = current?.slug || '';
        }
        values.slug = await this.allocateSlug(
          type,
          values.slug || entity.slugSource(values) || itemId,
          itemId
        );
      }
      const sets = Object.keys(values)
        .map((col, i) => `${col} = $${i + 1}`)
        .concat(`updated_at = $${Object.keys(values).length + 1}`)
        .join(', ');
      const params = [...Object.values(values), new Date().toISOString(), itemId];
      const { rows } = await db.query(
        `UPDATE ${entity.table} SET ${sets} WHERE id = $${params.length} RETURNING *`,
        params
      );
      return rows[0] ? entity.toClient(rows[0]) : null;
    },

    async remove(type, itemId) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(`DELETE FROM ${entity.table} WHERE id = $1 RETURNING *`, [itemId]);
      return rows[0] ? entity.toClient(rows[0]) : null;
    },

    async count(type) {
      const entity = ENTITIES[type];
      const { rows } = await db.query(`SELECT COUNT(*)::int AS total FROM ${entity.table}`);
      return rows[0].total;
    },

    async clear(type) {
      const entity = ENTITIES[type];
      await db.query(`DELETE FROM ${entity.table}`);
    },

    // ---------------------------------------------------------------- messages
    async listMessages(limit = 200) {
      const { rows } = await db.query(
        `SELECT * FROM messages ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        subject: r.subject,
        message: r.body,
        date: new Date(r.created_at).toLocaleString('en-GB'),
        is_read: r.is_read,
        created_at: r.created_at
      }));
    },

    async insertMessage(message) {
      const now = new Date();
      const newId = id(ID_PREFIX.message);
      const { rows } = await db.query(
        `INSERT INTO messages (id, name, email, subject, body, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, false, $6) RETURNING *`,
        [newId, message.name, message.email, message.subject, message.message, now.toISOString()]
      );
      return rows[0].id;
    },

    async deleteMessage(itemId) {
      const { rows } = await db.query('DELETE FROM messages WHERE id = $1 RETURNING id', [itemId]);
      return Boolean(rows[0]);
    },

    async clearMessages() {
      const { rows } = await db.query('DELETE FROM messages RETURNING id');
      return rows.length;
    },

    async markMessageRead(itemId, isRead) {
      const { rows } = await db.query(
        'UPDATE messages SET is_read = $1 WHERE id = $2 RETURNING id',
        [isRead, itemId]
      );
      return Boolean(rows[0]);
    },

    async countUnreadMessages() {
      const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM messages WHERE is_read = false');
      return rows[0].total;
    },

    // ------------------------------------------------------------- newsletter
    async subscribe(email) {
      const newId = id(ID_PREFIX.subscriber);
      const { rows } = await db.query(
        `INSERT INTO newsletter_subscribers (id, email) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [newId, email]
      );
      if (rows[0]) return { email, created: true };
      const existing = await db.query(
        'SELECT email, created_at FROM newsletter_subscribers WHERE email = $1',
        [email]
      );
      return { email, created: false, since: existing.rows[0]?.created_at };
    },

    async listSubscribers() {
      const { rows } = await db.query(
        'SELECT id, email, created_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 1000'
      );
      return rows;
    },

    async deleteSubscriber(subscriberId) {
      const { rows } = await db.query(
        'DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING email',
        [subscriberId]
      );
      return rows[0] || null;
    },

    async countSubscribers() {
      const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM newsletter_subscribers');
      return rows[0].total;
    },

    // ------------------------------------------------------------------- media
    async insertMedia({ id, contentType, bytes, data }) {
      await db.query(
        'INSERT INTO media (id, content_type, bytes, data) VALUES ($1, $2, $3, $4)',
        [id, contentType, bytes, data]
      );
      return { id, contentType, bytes };
    },

    async getMedia(id) {
      const { rows } = await db.query('SELECT content_type, bytes, data FROM media WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async deleteMedia(ids) {
      if (!ids.length) return 0;
      const { rowCount } = await db.query('DELETE FROM media WHERE id = ANY($1::text[])', [ids]);
      return rowCount;
    },

    async mediaUsage() {
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS count, COALESCE(SUM(bytes), 0)::bigint AS bytes FROM media'
      );
      return { count: rows[0].count, bytes: Number(rows[0].bytes) };
    },

    async clearMedia() {
      const { rowCount } = await db.query('DELETE FROM media');
      return rowCount;
    },

    // ------------------------------------------------------------------- site
    SITE_COLUMNS: [
      'hero_title', 'hero_sub_fa', 'hero_sub_en', 'hero_desc_fa', 'hero_desc_en',
      'about_fa', 'about_en', 'btn1_fa', 'btn1_en', 'btn2_fa', 'btn2_en',
      'social_x', 'social_instagram', 'social_youtube', 'social_discord'
    ],

    async getSite() {
      const { rows } = await db.query('SELECT * FROM site_settings WHERE id = $1', ['default']);
      return rows[0] ? this.getSiteValue(rows[0]) : null;
    },

    async saveSite(settings) {
      const params = ['default', ...this.SITE_COLUMNS.map((c) => settings[c]), new Date().toISOString()];
      const sets = this.SITE_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const { rows } = await db.query(
        `INSERT INTO site_settings (id, ${this.SITE_COLUMNS.join(', ')}, updated_at)
         VALUES ($1, ${this.SITE_COLUMNS.map((_, i) => `$${i + 2}`).join(', ')}, $${params.length})
         ON CONFLICT (id) DO UPDATE SET ${sets}, updated_at = $${params.length}
         RETURNING *`,
        params
      );
      return this.getSiteValue(rows[0]);
    },

    getSiteValue(r) {
      return {
        heroTitle: r.hero_title,
        heroSub_fa: r.hero_sub_fa,
        heroSub_en: r.hero_sub_en,
        heroDesc_fa: r.hero_desc_fa,
        heroDesc_en: r.hero_desc_en,
        aboutText_fa: r.about_fa,
        aboutText_en: r.about_en,
        btn1_fa: r.btn1_fa,
        btn1_en: r.btn1_en,
        btn2_fa: r.btn2_fa,
        btn2_en: r.btn2_en,
        socialX: r.social_x,
        socialInstagram: r.social_instagram,
        socialYoutube: r.social_youtube,
        socialDiscord: r.social_discord,
        updated_at: r.updated_at
      };
    },

    async resetSite() {
      await db.query('DELETE FROM site_settings WHERE id = $1', ['default']);
    },

    // ------------------------------------------------------------------ admins
    async findAdminByUsername(username) {
      const { rows } = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
      return rows[0] || null;
    },

    async findAdminById(adminId) {
      const { rows } = await db.query('SELECT * FROM admins WHERE id = $1', [adminId]);
      return rows[0] || null;
    },

    async countAdmins() {
      const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM admins');
      return rows[0].total;
    },

    async createAdmin({ username, passwordHash, displayName, permissions = [], isActive = true }) {
      const newId = id(ID_PREFIX.admin);
      const now = new Date().toISOString();
      const { rows } = await db.query(
        `INSERT INTO admins (id, username, password_hash, display_name, permissions, is_active, token_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7) RETURNING *`,
        [newId, username, passwordHash, displayName || 'Admin', permissions, isActive, now]
      );
      return rows[0];
    },

    async listAdmins() {
      const { rows } = await db.query(
        `SELECT id, username, display_name, permissions, is_active, token_version, created_at, updated_at
         FROM admins ORDER BY created_at ASC, id ASC`
      );
      return rows;
    },

    /** Profile, permission and activation edits. `logoutEverywhere` bumps
        token_version so every session of that account stops validating. */
    async updateAdminProfile(adminId, { displayName, permissions, isActive, logoutEverywhere }) {
      const { rows } = await db.query(
        `UPDATE admins
            SET display_name = $1, permissions = $2, is_active = $3,
                token_version = token_version + $4, updated_at = $5
          WHERE id = $6 RETURNING *`,
        [displayName, permissions, isActive, logoutEverywhere ? 1 : 0, new Date().toISOString(), adminId]
      );
      return rows[0] || null;
    },

    async deleteAdmin(adminId) {
      const { rows } = await db.query('DELETE FROM admins WHERE id = $1 RETURNING id', [adminId]);
      return Boolean(rows[0]);
    },

    async updateAdminPassword(adminId, passwordHash) {
      const { rows } = await db.query(
        `UPDATE admins SET password_hash = $1, token_version = token_version + 1, updated_at = $2
         WHERE id = $3 RETURNING *`,
        [passwordHash, new Date().toISOString(), adminId]
      );
      return rows[0] || null;
    },

    // ---------------------------------------------------------------- members
    memberClient(r) {
      return {
        id: r.id,
        username: r.username,
        email: r.email,
        display_name: r.display_name,
        is_active: r.is_active !== false,
        created_at: r.created_at,
        last_seen_at: r.last_seen_at
      };
    },

    /** Login accepts either handle, so the form asks for one field, not two. */
    async findMemberByLogin(login) {
      const value = String(login || '').trim().toLowerCase();
      if (!value) return null;
      const { rows } = await db.query(
        `SELECT * FROM members WHERE username = $1 OR (email <> '' AND lower(email) = $1) LIMIT 1`,
        [value]
      );
      return rows[0] || null;
    },

    async findMemberById(memberId) {
      const { rows } = await db.query('SELECT * FROM members WHERE id = $1', [memberId]);
      return rows[0] || null;
    },

    async createMember({ username, email = '', passwordHash, displayName = '' }) {
      const newId = id(ID_PREFIX.member);
      const now = new Date().toISOString();
      const { rows } = await db.query(
        `INSERT INTO members (id, username, email, password_hash, display_name, is_active, token_version, created_at, updated_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, true, 1, $6, $6, $6) RETURNING *`,
        [newId, username, email, passwordHash, displayName || username, now]
      );
      return rows[0];
    },

    async listMembers({ query = '', limit = 500 } = {}) {
      const pattern = `%${String(query).trim().toLowerCase()}%`;
      const { rows } = await db.query(
        `SELECT * FROM members
          WHERE username ILIKE $1 OR email ILIKE $1 OR display_name ILIKE $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2`,
        [pattern, limit]
      );
      return rows.map((r) => this.memberClient(r));
    },

    async countMembers() {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active)::int AS active,
                COUNT(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS recent
           FROM members`
      );
      return { total: rows[0].total, active: rows[0].active, recent: rows[0].recent };
    },

    /** Reads and writes last_seen_at in one statement: opening a gated page is
        the signal that an account is actually being used. */
    async touchMember(memberId) {
      const { rows } = await db.query(
        `UPDATE members SET last_seen_at = now() WHERE id = $1 RETURNING *`,
        [memberId]
      );
      return rows[0] || null;
    },

    async updateMemberProfile(memberId, { displayName, email, isActive, logoutEverywhere }) {
      const { rows } = await db.query(
        `UPDATE members
            SET display_name = $1, email = $2, is_active = $3,
                token_version = token_version + $4, updated_at = $5
          WHERE id = $6 RETURNING *`,
        [displayName, email, isActive, logoutEverywhere ? 1 : 0, new Date().toISOString(), memberId]
      );
      return rows[0] || null;
    },

    async updateMemberPassword(memberId, passwordHash) {
      const { rows } = await db.query(
        `UPDATE members SET password_hash = $1, token_version = token_version + 1, updated_at = $2
          WHERE id = $3 RETURNING *`,
        [passwordHash, new Date().toISOString(), memberId]
      );
      return rows[0] || null;
    },

    async deleteMember(memberId) {
      const { rows } = await db.query('DELETE FROM members WHERE id = $1 RETURNING id', [memberId]);
      return Boolean(rows[0]);
    },

    async clearMembers() {
      const { rowCount } = await db.query('DELETE FROM members');
      return rowCount;
    },

    // ------------------------------------------------------------------ spam
    /** Timestamp of the last message from an address, for the cooldown window. */
    async lastMessageAt(email) {
      const { rows } = await db.query(
        'SELECT created_at FROM messages WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 1',
        [email]
      );
      return rows[0]?.created_at || null;
    },

    /** Copy-paste spam arrives as the same text over and over; a first send of a
        given subject+body is never rejected. */
    async messageIsDuplicate({ email, subject, message, withinHours = 24 }) {
      const { rows } = await db.query(
        `SELECT id FROM messages
          WHERE lower(email) = lower($1) AND subject = $2 AND body = $3
            AND created_at > now() - ($4 || ' hours')::interval
          LIMIT 1`,
        [email, subject, message, String(withinHours)]
      );
      return Boolean(rows[0]);
    }
  };
}

export { ENTITIES };
