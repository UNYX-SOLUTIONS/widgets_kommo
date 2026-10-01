'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Almacén de tokens OAuth en un archivo JSON.
 * Solo el backend lo lee; nunca se expone al widget ni al navegador.
 */
class TokenStore {
  constructor(file) {
    this.file = file;
    this.entries = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      Object.entries(parsed || {}).forEach(([key, value]) => this.entries.set(key, value));
    } catch (error) {
      this.entries = new Map();
    }
  }

  persist() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {};
    this.entries.forEach((value, key) => {
      payload[key] = value;
    });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      /* best effort en sistemas de archivos sin permisos POSIX */
    }
  }

  static key(subdomain, userId) {
    return `${subdomain}:${userId}`;
  }

  get(subdomain, userId) {
    return this.entries.get(TokenStore.key(subdomain, userId)) || null;
  }

  set(subdomain, userId, entry) {
    this.entries.set(TokenStore.key(subdomain, userId), entry);
    this.persist();
  }

  remove(subdomain, userId) {
    this.entries.delete(TokenStore.key(subdomain, userId));
    this.persist();
  }

  size() {
    return this.entries.size;
  }
}

module.exports = { TokenStore };
