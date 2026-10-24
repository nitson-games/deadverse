import { ENTITIES } from '../server/repo.js';
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
    async nextSortOrder(type) {
      return sorted(type).reduce((max, row) => Math.max(max, row.sort_order + 1), 0);
    },
    async create(type, data) {
      const row = rowFrom(type, data, id(ENTITIES[type].prefix), data.sort_order ?? (await this.nextSortOrder(type)));
      store.tables[type].push(row);
      return ENTITIES[type].toClient(row);
    },
    async update(type, itemId, data) {
      const rows = store.tables[type];
      const index = rows.findIndex((row) => row.id === itemId);
      if (index === -1) return null;
      rows[index] = { ...rows[index], ...rowFrom(type, data, itemId, rows[index].sort_order), updated_at: new Date().toISOString() };
      return ENTITIES[type].toClient(rows[index]);
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
    }
  };
}
