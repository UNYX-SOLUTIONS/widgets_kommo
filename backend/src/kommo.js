'use strict';

const { searchVariants, matches } = require('./phone');

class KommoError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'KommoError';
    this.status = status || 502;
    this.detail = detail || null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

class KommoClient {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.pipelineCache = { at: 0, index: null };
    this.usersCache = { at: 0, names: null };
    this.phoneField = null;
    this.phoneFieldResolved = false;
  }

  baseUrl(subdomain) {
    return `https://${subdomain}.kommo.com`;
  }

  async request(subdomain, accessToken, method, pathname, options) {
    const settings = options || {};
    const url = new URL(this.baseUrl(subdomain) + pathname);
    Object.entries(settings.query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    });

    const headers = { accept: 'application/json' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (settings.body !== undefined) headers['content-type'] = 'application/json';

    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
          signal: AbortSignal.timeout(this.config.kommoApiTimeoutMs)
        });
      } catch (error) {
        lastError = new KommoError('No se pudo conectar con Kommo.', 502, error.message);
        await sleep(200 * (attempt + 1));
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new KommoError('Kommo respondió con un error temporal.', 503, `HTTP ${response.status}`);
        await sleep(400 * (attempt + 1));
        continue;
      }

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (error) {
        data = null;
      }

      if (!response.ok) {
        const detail = (data && (data.detail || data.title)) || `HTTP ${response.status}`;
        if (response.status === 401) {
          throw new KommoError('La sesión con Kommo expiró. Vuelva a autorizar el acceso.', 401, detail);
        }
        throw new KommoError('Kommo rechazó la solicitud.', response.status, detail);
      }

      return data;
    }

    throw lastError || new KommoError('Kommo no respondió.', 503);
  }

  async tokenRequest(subdomain, body) {
    const url = `${this.baseUrl(subdomain)}/oauth2/access_token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({
        client_id: this.config.kommoClientId,
        client_secret: this.config.kommoClientSecret,
        redirect_uri: this.config.kommoRedirectUri
      }, body)),
      signal: AbortSignal.timeout(this.config.kommoApiTimeoutMs)
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok || !data || !data.access_token) {
      throw new KommoError('No se pudo completar la autorización con Kommo.', 401, (data && data.detail) || `HTTP ${response.status}`);
    }

    const serverTime = (data.server_time || Math.floor(Date.now() / 1000)) * 1000;
    const expiresAt = serverTime + (data.expires_in || 86400) * 1000 - 60000;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt
    };
  }

  async exchangeAuthorizationCode(subdomain, code) {
    const tokens = await this.tokenRequest(subdomain, {
      grant_type: 'authorization_code',
      code
    });
    const claims = decodeJwtPayload(tokens.accessToken) || {};
    const userId = parseInt(claims.user_id || claims.sub || 0, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new KommoError('Kommo no devolvió el usuario autorizado.', 502, 'user_id ausente en el token');
    }
    const entry = {
      subdomain,
      userId,
      accountId: claims.account_id ? String(claims.account_id) : '',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date().toISOString()
    };
    this.store.set(subdomain, userId, entry);
    return entry;
  }

  async accessToken(subdomain, userId) {
    const entry = this.store.get(subdomain, userId);
    if (!entry) {
      const error = new KommoError('El usuario no ha autorizado el acceso.', 401, 'sin token');
      error.authRequired = true;
      throw error;
    }

    if (entry.expiresAt > Date.now() + 30000) {
      return { token: entry.accessToken, entry };
    }

    if (!entry.refreshToken) {
      this.store.remove(subdomain, userId);
      const error = new KommoError('La sesión con Kommo expiró. Vuelva a autorizar el acceso.', 401, 'sin refresh token');
      error.authRequired = true;
      throw error;
    }

    const tokens = await this.tokenRequest(subdomain, {
      grant_type: 'refresh_token',
      refresh_token: entry.refreshToken
    });
    const updated = Object.assign({}, entry, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || entry.refreshToken,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date().toISOString()
    });
    this.store.set(subdomain, userId, updated);
    return { token: updated.accessToken, entry: updated };
  }

  async findContacts(subdomain, token, e164) {
    const found = new Map();

    for (const variant of searchVariants(e164)) {
      const page = await this.request(subdomain, token, 'GET', '/api/v4/contacts', {
        query: { query: variant, with: 'leads', limit: 100 }
      });
      const contacts = (page && page._embedded && page._embedded.contacts) || [];
      contacts.forEach((contact) => {
        if (!contact || contact.is_deleted) return;
        const phones = [];
        (contact.custom_fields_values || []).forEach((field) => {
          (field.values || []).forEach((entry) => {
            if (entry && entry.value !== undefined && entry.value !== null) phones.push(String(entry.value));
          });
        });
        if (phones.some((value) => matches(e164, value))) {
          found.set(contact.id, contact);
        }
      });
      if (found.size > 0) break;
    }

    return Array.from(found.values());
  }

  async getLeads(subdomain, token, ids) {
    if (!ids.length) return [];
    const page = await this.request(subdomain, token, 'GET', '/api/v4/leads', {
      query: { 'filter[id][]': ids, limit: 250 }
    });
    return ((page && page._embedded && page._embedded.leads) || []).filter((lead) => lead && !lead.is_deleted);
  }

  async pipelineIndex(subdomain, token) {
    if (this.pipelineCache.index && Date.now() - this.pipelineCache.at < 300000) {
      return this.pipelineCache.index;
    }

    const pipelines = await this.request(subdomain, token, 'GET', '/api/v4/leads/pipelines');
    const list = (pipelines && pipelines._embedded && pipelines._embedded.pipelines) || [];
    const stageById = new Map();
    const pipelineById = new Map();

    for (const pipeline of list) {
      pipelineById.set(pipeline.id, pipeline);
      const statuses = await this.request(subdomain, token, 'GET', `/api/v4/leads/pipelines/${pipeline.id}/statuses`);
      const items = (statuses && statuses._embedded && statuses._embedded.statuses) || [];
      items.forEach((stage) => {
        stage.pipeline_name = pipeline.name;
        stageById.set(stage.id, stage);
      });
    }

    this.pipelineCache = { at: Date.now(), index: { stageById, pipelineById } };
    return this.pipelineCache.index;
  }

  async userNames(subdomain, token) {
    if (this.usersCache.names && Date.now() - this.usersCache.at < 300000) {
      return this.usersCache.names;
    }
    try {
      const page = await this.request(subdomain, token, 'GET', '/api/v4/users', { query: { limit: 250 } });
      const users = (page && page._embedded && page._embedded.users) || [];
      const names = new Map(users.map((user) => [user.id, user.name]));
      this.usersCache = { at: Date.now(), names };
      return names;
    } catch (error) {
      this.usersCache = { at: Date.now(), names: new Map() };
      return this.usersCache.names;
    }
  }

  isClosedStage(stage) {
    if (!stage) return false;
    if (typeof stage.sort === 'number' && stage.sort >= this.config.closedStageSortMin) return true;
    const pattern = this.config.closedStagePattern ? new RegExp(this.config.closedStagePattern, 'i') : null;
    return Boolean(pattern && pattern.test(String(stage.name || '')));
  }

  async contactPhoneField(subdomain, token) {
    if (this.phoneFieldResolved) return this.phoneField;
    const page = await this.request(subdomain, token, 'GET', '/api/v4/contacts/fields');
    const fields = (page && page._embedded && page._embedded.custom_fields) || [];
    const field = fields.find((item) => item.field_type === 'multitext' && String(item.field_code || '').toUpperCase() === 'PHONE');
    this.phoneField = field || null;
    this.phoneFieldResolved = true;
    return this.phoneField;
  }

  async createContact(subdomain, token, e164, name, responsibleUserId) {
    const payload = {
      name,
      created_by: responsibleUserId,
      updated_by: responsibleUserId,
      responsible_user_id: responsibleUserId
    };

    const field = await this.contactPhoneField(subdomain, token);
    if (field) {
      payload.custom_fields_values = [
        { field_id: field.id, values: [{ value: e164, enum_code: 'WORK' }] }
      ];
    }

    const result = await this.request(subdomain, token, 'POST', '/api/v4/contacts', { body: [payload] });
    const created = (result && result._embedded && result._embedded.contacts) || [];
    if (!created.length || !created[0].id) {
      throw new KommoError('No se pudo crear el contacto.', 502, 'respuesta sin id');
    }
    return created[0].id;
  }

  async createLead(subdomain, token, payload) {
    const result = await this.request(subdomain, token, 'POST', '/api/v4/leads', { body: [payload] });
    const created = (result && result._embedded && result._embedded.leads) || [];
    if (!created.length || !created[0].id) {
      throw new KommoError('No se pudo crear el lead.', 502, 'respuesta sin id');
    }
    return created[0].id;
  }
}

module.exports = { KommoClient, KommoError, decodeJwtPayload };
