'use strict';

const { normalizeEcMobile } = require('./phone');
const { createToken, readToken } = require('./security');

class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.payload = payload || null;
  }
}

/**
 * Reglas de negocio del widget «Verificar Cliente».
 * Toda comprobación se hace con el token del asesor que consulta: el backend
 * nunca usa credenciales globales para decidir a nombre de un usuario.
 */
class VerificarService {
  constructor(config, kommo, store) {
    this.config = config;
    this.kommo = kommo;
    this.store = store;
    this.locks = new Map();
  }

  checkSecret() {
    return this.config.checkSecret || this.config.sessionSecret;
  }

  /** Serializa las operaciones de un mismo número para evitar carreras. */
  async withLock(key, task) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.locks.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  assertAccount(subdomain) {
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{1,60}$/i.test(subdomain)) {
      throw new HttpError(400, 'Cuenta de Kommo no válida.');
    }
    if (this.config.kommoSubdomain && subdomain.toLowerCase() !== this.config.kommoSubdomain.toLowerCase()) {
      throw new HttpError(403, 'Esta cuenta de Kommo no está habilitada para el servicio.');
    }
  }

  async accessToken(subdomain, userId) {
    try {
      const { token } = await this.kommo.accessToken(subdomain, userId);
      return token;
    } catch (error) {
      if (error.authRequired) {
        throw new HttpError(401, error.message, { authRequired: true });
      }
      throw error;
    }
  }

  async analyze(subdomain, userId, e164) {
    const token = await this.accessToken(subdomain, userId);
    const contacts = await this.kommo.findContacts(subdomain, token, e164);

    const leadIds = [];
    contacts.forEach((contact) => {
      const linked = (contact._embedded && contact._embedded.leads) || [];
      linked.forEach((lead) => {
        if (lead && lead.id && !leadIds.includes(lead.id)) leadIds.push(lead.id);
      });
    });

    const leads = await this.kommo.getLeads(subdomain, token, leadIds);
    const { stageById } = await this.kommo.pipelineIndex(subdomain, token);
    const userNames = await this.kommo.userNames(subdomain, token);

    const decorated = leads.map((lead) => {
      const stage = stageById.get(lead.status_id) || null;
      const closed = Boolean(lead.closed_at) || this.kommo.isClosedStage(stage);
      return {
        id: lead.id,
        name: lead.name || `#${lead.id}`,
        responsible_user_id: lead.responsible_user_id || 0,
        responsibleName: userNames.get(lead.responsible_user_id) || '',
        statusName: stage ? stage.name : '',
        pipelineName: stage ? stage.pipeline_name || '' : '',
        created_at: lead.created_at || 0,
        closed,
        leadUrl: `https://${subdomain}.kommo.com/leads/${lead.id}`
      };
    });

    const active = decorated
      .filter((lead) => !lead.closed)
      .sort((a, b) => b.created_at - a.created_at);

    const closed = decorated.filter((lead) => lead.closed);
    const contact = contacts[0] || null;

    let state = 'available';
    let activeLead = null;

    if (active.length > 1) {
      state = 'multiple_leads';
    } else if (active.length === 1) {
      activeLead = active[0];
      state = activeLead.responsible_user_id === userId ? 'same_agent' : 'other_agent';
    }

    return {
      state,
      phone: e164,
      contact,
      contactCount: contacts.length,
      contactName: contact ? contact.name || '' : '',
      activeLead,
      leads: active,
      closedLeadCount: closed.length,
      token
    };
  }

  async check(subdomain, userId, rawPhone) {
    this.assertAccount(subdomain);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new HttpError(400, 'No se pudo identificar al asesor actual.');
    }
    const e164 = normalizeEcMobile(rawPhone);
    if (!e164) {
      throw new HttpError(400, 'Ingrese 9 dígitos y seleccione un celular válido.');
    }

    const result = await this.analyze(subdomain, userId, e164);

    return {
      ok: true,
      state: result.state,
      phone: result.phone,
      contactName: result.contactName,
      contactCount: result.contactCount,
      closedLeadCount: result.closedLeadCount,
      activeLead: result.activeLead,
      leads: result.state === 'multiple_leads' ? result.leads : undefined,
      checkId: createToken(this.checkSecret(), {
        sub: subdomain,
        user: userId,
        phone: e164,
        state: result.state
      }, this.config.checkTtlSeconds)
    };
  }

  leadName(template, contactName, e164) {
    return String(template)
      .replace(/\{name\}/g, contactName || e164)
      .replace(/\{phone\}/g, e164);
  }

  async createLead(subdomain, userId, rawPhone, checkId) {
    this.assertAccount(subdomain);
    const e164 = normalizeEcMobile(rawPhone);
    if (!e164) {
      throw new HttpError(400, 'Ingrese 9 dígitos y seleccione un celular válido.');
    }

    const claims = readToken(this.checkSecret(), checkId);
    if (!claims) {
      throw new HttpError(409, 'La verificación caducó. Vuelva a verificar el cliente.');
    }
    if (claims.sub !== subdomain || claims.user !== userId || claims.phone !== e164 || claims.state !== 'available') {
      throw new HttpError(409, 'La verificación no corresponde a este cliente. Vuelva a verificar.');
    }

    return this.withLock(`${subdomain}:${e164}`, async () => {
      const fresh = await this.analyze(subdomain, userId, e164);

      if (fresh.state !== 'available') {
        throw new HttpError(409, 'Apareció otra atención activa para este cliente.', {
          state: fresh.state,
          activeLead: fresh.activeLead
        });
      }

      const contactName = fresh.contactName || this.config.contactNameFallback.replace(/\{phone\}/g, e164);
      let contactId = fresh.contact ? fresh.contact.id : null;
      if (!contactId) {
        contactId = await this.kommo.createContact(subdomain, fresh.token, e164, contactName, userId);
      }

      const payload = {
        name: this.leadName(this.config.leadNameTemplate, fresh.contactName, e164),
        responsible_user_id: userId,
        created_by: userId,
        updated_by: userId,
        _embedded: {
          contacts: [{ id: contactId, is_main: true }]
        }
      };
      if (this.config.leadPipelineId) payload.pipeline_id = this.config.leadPipelineId;
      if (this.config.leadStatusId) payload.status_id = this.config.leadStatusId;
      if (this.config.leadSourceExternalId) {
        payload._embedded.source = { external_id: this.config.leadSourceExternalId };
      }

      const leadId = await this.kommo.createLead(subdomain, fresh.token, payload);

      return {
        ok: true,
        leadId,
        leadName: payload.name,
        contactId,
        leadUrl: `https://${subdomain}.kommo.com/leads/${leadId}`
      };
    });
  }
}

module.exports = { VerificarService, HttpError };
