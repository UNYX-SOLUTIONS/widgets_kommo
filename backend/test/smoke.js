'use strict';

const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.TOKEN_FILE = path.join(os.tmpdir(), `unyx-smoke-${process.pid}.json`);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.CHECK_SECRET = 'test-check-secret';
process.env.LEAD_NAME_TEMPLATE = '{name} · {phone}';

const config = require('../src/config').load();
const { TokenStore } = require('../src/store');
const { VerificarService } = require('../src/service');
const { normalizeEcMobile, matches: phoneMatches } = require('../src/phone');

const STORE = {
  contacts: new Map(),
  leads: new Map(),
  pipelines: new Map(),
  created: []
};

function seedContact(id, name, phone, leadIds) {
  STORE.contacts.set(id, {
    id,
    name,
    is_deleted: false,
    custom_fields_values: [{ field_id: 1, values: [{ value: phone }] }],
    _embedded: { leads: leadIds.map((value) => ({ id: value })) }
  });
}

function seedLead(id, name, responsible, statusId, closedAt) {
  STORE.leads.set(id, {
    id,
    name,
    responsible_user_id: responsible,
    status_id: statusId,
    created_at: 1700000000 + id,
    closed_at: closedAt || null,
    is_deleted: false
  });
}

seedContact(10, 'María Zambrano', '0991234567', []);
seedContact(11, 'Carlos Pérez', '593998765432', [21]);
seedContact(12, 'Jorge Villalba', '+593 997777777', [31, 32, 33]);
seedLead(21, 'Carlos Pérez', 555, 1, null);
seedLead(31, 'Jorge Villalba', 555, 1, null);
seedLead(32, 'Jorge V.', 777, 1, null);
seedLead(33, 'Jorge V. (cerrado)', 777, 2, 1700000099);

STORE.pipelines.set(1, { id: 1, name: 'Ventas', sort: 20 });
STORE.pipelines.set(2, { id: 2, name: 'Cerrado', sort: 10000 });

const FakeKommo = {
  async accessToken() {
    return { token: 'fake-token', entry: {} };
  },
  async findContacts(subdomain, token, e164) {
    const found = new Map();
    STORE.contacts.forEach((contact) => {
      const phones = [];
      (contact.custom_fields_values || []).forEach((field) => {
        (field.values || []).forEach((entry) => phones.push(entry.value));
      });
      if (phones.some((value) => phoneMatches(e164, value))) found.set(contact.id, contact);
    });
    return Array.from(found.values());
  },
  async getLeads(subdomain, token, ids) {
    return ids.map((id) => STORE.leads.get(id)).filter(Boolean);
  },
  async pipelineIndex() {
    return { stageById: STORE.pipelines, pipelineById: new Map() };
  },
  async userNames() {
    return new Map([[555, 'Asesor UNYX'], [777, 'Otra Asesora']]);
  },
  isClosedStage(stage) {
    return Boolean(stage && stage.sort >= config.closedStageSortMin);
  },
  async createContact(subdomain, token, e164, name) {
    const id = 900 + STORE.created.length;
    seedContact(id, name, e164, []);
    return id;
  },
  async createLead(subdomain, token, payload) {
    const id = 9000 + STORE.created.length;
    STORE.created.push(payload);
    seedLead(id, payload.name, payload.responsible_user_id, 1, null);
    (payload._embedded.contacts || []).forEach((link) => {
      const contact = STORE.contacts.get(link.id);
      if (contact) contact._embedded.leads.push({ id });
    });
    return id;
  }
};

const results = [];
function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail: detail || '' });
}

async function main() {
  const store = new TokenStore(process.env.TOKEN_FILE);
  const service = new VerificarService(config, FakeKommo, store);
  const account = 'unyx-test';
  const me = 555;
  const other = 777;

  check('normaliza 991234567', normalizeEcMobile('991234567') === '+593991234567');
  check('normaliza 0991234567', normalizeEcMobile('0991234567') === '+593991234567');
  check('rechaza fijo', normalizeEcMobile('21234567') === null);

  const free = await service.check(account, me, '991234567');
  check('contacto sin lead -> available', free.state === 'available', JSON.stringify(free));
  check('available trae nombre de contacto', free.contactName === 'María Zambrano');
  check('available trae checkId', typeof free.checkId === 'string' && free.checkId.length > 20);

  const mine = await service.check(account, me, '998765432');
  check('lead propio -> same_agent', mine.state === 'same_agent', JSON.stringify(mine));
  check('same_agent muestra asesor', mine.activeLead && mine.activeLead.responsibleName === 'Asesor UNYX');

  const notMine = await service.check(account, other, '998765432');
  check('lead ajeno -> other_agent', notMine.state === 'other_agent', JSON.stringify(notMine));
  check('other_agent muestra responsable', notMine.activeLead && notMine.activeLead.responsibleName === 'Asesor UNYX', JSON.stringify(notMine));

  const multi = await service.check(account, me, '997777777');
  check('varios activos -> multiple_leads', multi.state === 'multiple_leads', JSON.stringify(multi));
  check('multiple_leads lista 2 leads', Array.isArray(multi.leads) && multi.leads.length === 2);

  let rejected = false;
  try {
    await service.createLead(account, me, '998765432', mine.checkId);
  } catch (error) {
    rejected = error.status === 409;
  }
  check('no crea si el checkId no es available', rejected);

  const created = await service.createLead(account, me, '991234567', free.checkId);
  check('crea lead disponible', created.ok === true && created.leadId > 0, JSON.stringify(created));
  check('reutiliza el contacto existente', STORE.created[0]._embedded.contacts[0].id === 10);
  check('asigna al asesor actual', STORE.created[0].responsible_user_id === 555);
  check('nombre del lead usa la plantilla', STORE.created[0].name === 'María Zambrano · +593991234567', STORE.created[0].name);
  check('devuelve URL del lead', created.leadUrl === `https://${account}.kommo.com/leads/${created.leadId}`);

  const after = await service.check(account, me, '991234567');
  check('tras crear ya no está available', after.state === 'same_agent', JSON.stringify(after.state));

  let raced = '';
  const fresh = await service.check(account, me, '993333444');
  STORE.leads.set(410, {
    id: 410,
    name: 'Lead de otro asesor',
    responsible_user_id: other,
    status_id: 1,
    created_at: 1800000000,
    closed_at: null,
    is_deleted: false
  });
  seedContact(20, 'Ana Ríos', '0993333444', [410]);
  try {
    await service.createLead(account, me, '993333444', fresh.checkId);
    raced = 'no bloqueó';
  } catch (error) {
    raced = `${error.status} ${error.message}`;
  }
  check('revalida antes de crear (carrera)', raced.startsWith('409'), raced);

  const reused = await service.check(account, me, '995555555');
  const createdNew = await service.createLead(account, me, '995555555', reused.checkId);
  check('crea contacto si no existe', createdNew.contactId === 900 + STORE.created.length - 1, JSON.stringify(createdNew));

  let tampered = false;
  try {
    await service.createLead(account, me, '995555555', 'abc.def');
  } catch (error) {
    tampered = error.status === 409;
  }
  check('rechaza checkId manipulado', tampered);

  const failed = results.filter((item) => !item.ok);
  results.forEach((item) => {
    console.log(`${item.ok ? 'OK  ' : 'FAIL'}  ${item.label}${item.detail ? '  → ' + item.detail : ''}`);
  });
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
