import { ENTITIES, slugify } from '../server/repo.js';
import { ID_PREFIX, id } from '../server/ids.js';
import { siteToClient } from '../server/seed.js';

function rowFrom(type, data, newId, sortOrder) {
  const entity = ENTITIES[type];
  const now = new Date().toISOString();
  const row = { id: newId, sort_order: sortOrder, created_at: now, updated_at: now };
  for (const field of entity.fields) row[field] = data[field];
  for (const image of entity.images) {
    row[image.url] = data[image.input] || '';
    row[image.pid] = data[image.pidInput] || '';
  }
  return row;
}

/**
 * Same surface as makeRepo(), backed by plain objects. Lets the HTTP layer be
 * exercised without a live Postgres; SQL itself is covered by server/verify.js
 * against the real Neon database.
 */
export function createStore() {
  return {
    tables: { comic: [], article: [], movie: [], character: [], team: [] },
    admins: [],
    members: [],
    messages: [],
    subscribers: [],
    media: new Map(),
    site: null
  };
}

export function makeFakeRepo(store) {
  const sorted = (type) =>
    [...store.tables[type]].sort(
      (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    );

  return {
    entities: ENTITIES,

    async list(type) {
      return sorted(type).map(ENTITIES[type].toClient);
    },
    async findRaw(type, itemId) {
      return sorted(type).find((row) => row.id === itemId) || null;
    },
    async find(type, itemId) {
      const row = await this.findRaw(type, itemId);
      return row ? ENTITIES[type].toClient(row) : null;
    },
    async slugTaken(type, slug, exceptId = null) {
      return store.tables[type].some((row) => row.slug === slug && row.id !== (exceptId || ''));
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
      const row = store.tables[type].find((r) => r.slug === slug);
      return row ? ENTITIES[type].toClient(row) : null;
    },
    async backfillSlugs(type) {
      let filled = 0;
      for (const row of store.tables[type].filter((r) => !r.slug)) {
        const client = ENTITIES[type].toClient(row);
        row.slug = await this.allocateSlug(type, client.title_en || client.name_en || client.id, row.id);
        filled += 1;
      }
      return filled;
    },
    async nextSortOrder(type) {
      return sorted(type).reduce((max, row) => Math.max(max, row.sort_order + 1), 0);
    },
    async create(type, data) {
      const entity = ENTITIES[type];
      const values = { ...data };
      if (entity.hasSlug) {
        values.slug = await this.allocateSlug(type, values.slug || entity.slugSource(values));
      }
      const row = rowFrom(type, values, id(entity.prefix), data.sort_order ?? (await this.nextSortOrder(type)));
      store.tables[type].push(row);
      return entity.toClient(row);
    },
    async update(type, itemId, data) {
      const entity = ENTITIES[type];
      const rows = store.tables[type];
      const index = rows.findIndex((row) => row.id === itemId);
      if (index === -1) return null;
      const values = { ...data };
      if (entity.hasSlug) {
        if (!values.slug) {
          const current = store.tables[type].find((row) => row.id === itemId);
          values.slug = current?.slug || '';
        }
        values.slug = await this.allocateSlug(
          type,
          values.slug || entity.slugSource(values) || itemId,
          itemId
        );
      }
      rows[index] = { ...rows[index], ...rowFrom(type, values, itemId, rows[index].sort_order), updated_at: new Date().toISOString() };
      return entity.toClient(rows[index]);
    },
    async remove(type, itemId) {
      const rows = store.tables[type];
      const index = rows.findIndex((row) => row.id === itemId);
      if (index === -1) return null;
      return ENTITIES[type].toClient(rows.splice(index, 1)[0]);
    },
    async count(type) {
      return store.tables[type].length;
    },
    async clear(type) {
      store.tables[type] = [];
    },

    async listMessages(limit = 200) {
      return [...store.messages]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((m) => ({ ...m, message: m.body, date: new Date(m.created_at).toLocaleString('en-GB') }));
    },
    async insertMessage(message) {
      const row = {
        id: id(ID_PREFIX.message),
        name: message.name,
        email: message.email,
        subject: message.subject,
        body: message.message,
        is_read: false,
        created_at: new Date().toISOString()
      };
      store.messages.push(row);
      return row.id;
    },
    async deleteMessage(itemId) {
      const before = store.messages.length;
      store.messages = store.messages.filter((m) => m.id !== itemId);
      return store.messages.length < before;
    },
    async clearMessages() {
      const deleted = store.messages.length;
      store.messages = [];
      return deleted;
    },
    async markMessageRead(itemId, isRead) {
      const row = store.messages.find((m) => m.id === itemId);
      if (!row) return false;
      row.is_read = isRead;
      return true;
    },
    async countUnreadMessages() {
      return store.messages.filter((m) => !m.is_read).length;
    },

    async subscribe(email) {
      const existing = store.subscribers.find((s) => s.email === email);
      if (existing) return { email, created: false };
      store.subscribers.push({ id: id(ID_PREFIX.subscriber), email, created_at: new Date().toISOString() });
      return { email, created: true };
    },
    async listSubscribers() {
      return [...store.subscribers];
    },
    async deleteSubscriber(subscriberId) {
      const index = store.subscribers.findIndex((s) => s.id === subscriberId);
      if (index === -1) return null;
      return store.subscribers.splice(index, 1)[0];
    },
    async countSubscribers() {
      return store.subscribers.length;
    },

    async insertMedia({ id: mediaId, contentType, bytes, data }) {
      store.media.set(mediaId, { content_type: contentType, bytes, data });
      return { id: mediaId, contentType, bytes };
    },
    async getMedia(mediaId) {
      return store.media.get(mediaId) || null;
    },
    async deleteMedia(ids) {
      let deleted = 0;
      for (const mediaId of ids) {
        if (store.media.delete(mediaId)) deleted += 1;
      }
      return deleted;
    },
    async mediaUsage() {
      let bytes = 0;
      for (const row of store.media.values()) bytes += row.bytes;
      return { count: store.media.size, bytes };
    },
    async clearMedia() {
      const deleted = store.media.size;
      store.media.clear();
      return deleted;
    },

    async getSite() {
      return store.site ? siteToClient(store.site) : null;
    },
    async saveSite(settings) {
      store.site = { ...settings };
      return siteToClient(store.site);
    },
    async resetSite() {
      store.site = null;
    },

    async findAdminByUsername(username) {
      return store.admins.find((a) => a.username === username) || null;
    },
    async findAdminById(adminId) {
      return store.admins.find((a) => a.id === adminId) || null;
    },
    async countAdmins() {
      return store.admins.length;
    },
    async createAdmin({ username, passwordHash, displayName, permissions = [], isActive = true }) {
      const row = {
        id: id(ID_PREFIX.admin),
        username,
        password_hash: passwordHash,
        display_name: displayName || 'Admin',
        permissions,
        is_active: isActive,
        token_version: 1
      };
      store.admins.push(row);
      return row;
    },
    async listAdmins() {
      return [...store.admins];
    },
    async updateAdminProfile(adminId, { displayName, permissions, isActive, logoutEverywhere }) {
      const row = store.admins.find((a) => a.id === adminId);
      if (!row) return null;
      row.display_name = displayName;
      row.permissions = permissions;
      row.is_active = isActive;
      if (logoutEverywhere) row.token_version += 1;
      return row;
    },
    async deleteAdmin(adminId) {
      const index = store.admins.findIndex((a) => a.id === adminId);
      if (index === -1) return false;
      store.admins.splice(index, 1);
      return true;
    },
    async updateAdminPassword(adminId, passwordHash) {
      const row = store.admins.find((a) => a.id === adminId);
      if (!row) return null;
      row.password_hash = passwordHash;
      row.token_version += 1;
      return row;
    },

    memberClient(row) {
      return {
        id: row.id,
        username: row.username,
        email: row.email || '',
        display_name: row.display_name,
        is_active: row.is_active !== false,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at || null
      };
    },
    async findMemberByLogin(login) {
      const value = String(login || '').trim().toLowerCase();
      return store.members.find((m) => m.username === value || (m.email || '').toLowerCase() === value) || null;
    },
    async findMemberById(memberId) {
      return store.members.find((m) => m.id === memberId) || null;
    },
    async createMember({ username, email = '', passwordHash, displayName = '' }) {
      const now = new Date().toISOString();
      const row = {
        id: id(ID_PREFIX.member),
        username,
        email,
        password_hash: passwordHash,
        display_name: displayName || username,
        is_active: true,
        token_version: 1,
        created_at: now,
        updated_at: now,
        last_seen_at: now
      };
      store.members.push(row);
      return row;
    },
    async listMembers({ query = '', limit = 500 } = {}) {
      const needle = String(query).trim().toLowerCase();
      return store.members
        .filter((m) => !needle || `${m.username} ${m.email} ${m.display_name}`.toLowerCase().includes(needle))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((m) => this.memberClient(m));
    },
    async countMembers() {
      return {
        total: store.members.length,
        active: store.members.filter((m) => m.is_active !== false).length,
        recent: store.members.filter(
          (m) => m.last_seen_at && Date.now() - new Date(m.last_seen_at).getTime() < 7 * 864e5
        ).length
      };
    },
    async touchMember(memberId) {
      const row = store.members.find((m) => m.id === memberId);
      if (!row) return null;
      row.last_seen_at = new Date().toISOString();
      return row;
    },
    async updateMemberProfile(memberId, { displayName, email, isActive, logoutEverywhere }) {
      const row = store.members.find((m) => m.id === memberId);
      if (!row) return null;
      row.display_name = displayName;
      row.email = email;
      row.is_active = isActive;
      if (logoutEverywhere) row.token_version += 1;
      return row;
    },
    async updateMemberPassword(memberId, passwordHash) {
      const row = store.members.find((m) => m.id === memberId);
      if (!row) return null;
      row.password_hash = passwordHash;
      row.token_version += 1;
      return row;
    },
    async deleteMember(memberId) {
      const index = store.members.findIndex((m) => m.id === memberId);
      if (index === -1) return false;
      store.members.splice(index, 1);
      return true;
    },
    async clearMembers() {
      const deleted = store.members.length;
      store.members = [];
      return deleted;
    },

    async lastMessageAt(email) {
      const value = String(email || '').toLowerCase();
      const rows = store.messages
        .filter((m) => m.email.toLowerCase() === value)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows[0]?.created_at || null;
    },
    async messageIsDuplicate({ email, subject, message }) {
      const value = String(email || '').toLowerCase();
      return store.messages.some(
        (m) =>
          m.email.toLowerCase() === value &&
          m.subject === subject &&
          m.body === message &&
          Date.now() - new Date(m.created_at).getTime() < 24 * 3600_000
      );
    }
  };
}
