'use strict';

/**
 * Prueba la lógica de los nodos Code de los workflows sin n8n.
 * Los snippets se extraen de los JSON generados, así se valida también
 * que build.js los haya incrustado bien.
 *
 * Uso: node unyx/n8n/test/logic.test.js
 */

const fs = require('fs');
const path = require('path');

const N8N_DIR = path.join(__dirname, '..');

const results = [];
function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail: detail === undefined ? '' : String(detail) });
}

function loadWorkflow(file) {
  return JSON.parse(fs.readFileSync(path.join(N8N_DIR, file), 'utf8'));
}

function snippetOf(workflow, nodeName) {
  const node = workflow.nodes.find((item) => item.name === nodeName);
  if (!node) throw new Error('No existe el nodo ' + nodeName + ' en ' + workflow.name);
  return node.parameters.jsCode;
}

function run(snippet, ctx) {
  const nodes = ctx.nodes || {};
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) {
      throw new Error('El nodo "' + name + '" no se ejecutó en esta corrida.');
    }
    const items = nodes[name];
    return { first: () => items[0], all: () => items, item: items[0] };
  };
  const input = ctx.input || [];
  const $input = { all: () => input, first: () => input[0] };
  const fn = new Function('$input', '$', '$json', snippet);
  return fn($input, $, ctx.json);
}

const config = JSON.parse(fs.readFileSync(path.join(N8N_DIR, 'clientes.json'), 'utf8'));
const cliente = config.clientes.find((item) => item.slug === 'meditec');
const tipoCredencial = (item) => (item.credencial.tipo === 'httpBearerAuth' ? 'httpBearerAuth' : 'httpHeaderAuth');

const slugs = config.clientes.map((item) => item.slug);
check('clientes: un slug por cliente, sin repetidos', new Set(slugs).size === slugs.length, slugs.join(', '));
check(
  'clientes: cada credencial tiene id, nombre y tipo válido',
  config.clientes.every((item) => item.credencial && item.credencial.id && item.credencial.name && ['httpHeaderAuth', 'httpBearerAuth'].includes(item.credencial.tipo)),
  JSON.stringify(config.clientes.map((item) => item.slug + ':' + item.credencial.tipo))
);

const verificar = loadWorkflow('unyx-' + cliente.slug + '-verificar-cliente.json');
const crear = loadWorkflow('unyx-' + cliente.slug + '-crear-lead.json');
const widgetScript = fs.readFileSync(path.join(N8N_DIR, '..', 'duplicados', 'script.js'), 'utf8');

// ---------- Estructura de los workflows ----------

for (const workflow of [verificar, crear]) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  const broken = [];
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(from)) broken.push('origen ' + from);
    for (const branch of outputs.main) {
      for (const link of branch) {
        if (!names.has(link.node)) broken.push(from + ' -> ' + link.node);
      }
    }
  }
  check(workflow.name + ': conexiones válidas', broken.length === 0, broken.join(', '));
  check(workflow.name + ': tiene Respond to Webhook', workflow.nodes.some((n) => n.type === 'n8n-nodes-base.respondToWebhook'));
  const http = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const tipo = tipoCredencial(cliente);
  check(
    workflow.name + ': todos los HTTP usan la credencial del cliente',
    http.length > 0 && http.every((n) => n.credentials[tipo] && n.credentials[tipo].id === cliente.credencial.id && n.parameters.genericAuthType === tipo),
    http.length + ' nodos HTTP · ' + tipo
  );
  check(workflow.name + ': no consulta pipelines ni etapas', !workflow.nodes.some((n) => String(n.parameters.url || '').includes('/pipelines')));
  check(workflow.name + ': cada cuenta tiene su ruta', workflow.nodes.some((n) => n.parameters.path === 'unyx-' + cliente.slug + '/verificar-cliente' || n.parameters.path === 'unyx-' + cliente.slug + '/crear-lead'));
  check(workflow.name + ': el subdominio quedó resuelto', !JSON.stringify(workflow).includes('__SUBDOMINIO__'));
}

// ---------- Preparar Consultas ----------

const preparar = snippetOf(verificar, 'Preparar Consultas');

check(
  'preparar: acepta 991234567',
  run(preparar, { json: { body: { phone: '991234567', userId: '555' } } })[0].json.phone === '+593991234567'
);

const variantes = run(preparar, { json: { body: { phone: '+593 99 123 4567', userId: 555 } } });
check('preparar: genera 3 variantes', variantes.length === 3, JSON.stringify(variantes.map((i) => i.json.variant)));
check('preparar: variantes correctas', JSON.stringify(variantes.map((i) => i.json.variant)) === JSON.stringify(['991234567', '0991234567', '+593991234567']));
check('preparar: conserva el asesor', variantes[0].json.userId === 555);
check(
  'preparar: rechaza un fijo',
  (() => {
    try {
      run(preparar, { json: { body: { phone: '022345678' } } });
      return false;
    } catch (error) {
      return true;
    }
  })()
);

// ---------- Cuenta Correcta (guarda multi-cliente) ----------

const guardNode = verificar.nodes.find((n) => n.name === 'Cuenta Correcta');
const guardExpression = guardNode.parameters.conditions.conditions[0].leftValue
  .replace(/^=/, '')
  .replace(/^\{\{/, '')
  .replace(/\}\}$/, '')
  .trim();

function guard(account) {
  const fn = new Function('$json', 'return (' + guardExpression + ');');
  return fn({ body: { account } });
}

check('guarda: acepta la cuenta del cliente', guard(cliente.subdominio) === true);
check('guarda: acepta mayúsculas y espacios', guard('  ' + cliente.subdominio.toUpperCase() + ' ') === true);
check('guarda: rechaza otra cuenta', guard('otraempresa') === false, 'otraempresa');
check('guarda: rechaza sin cuenta', guard('') === false && guard(undefined) === false);
const guardBody = snippetOf(crear, 'Cuenta No Autorizada');
check('guarda: responde ok:false con mensaje', run(guardBody, { json: {} })[0].json.ok === false);

// ---------- Unificar Contactos ----------

const unificar = snippetOf(verificar, 'Unificar Contactos');

const respuestaContactos = {
  _embedded: {
    contacts: [
      {
        id: 501,
        name: 'María Zambrano',
        custom_fields_values: [{ field_id: 1, values: [{ value: '0991234567' }] }],
        _embedded: { leads: [{ id: 900 }, { id: 901 }] },
      },
      {
        id: 502,
        name: 'Otro con el mismo formato',
        custom_fields_values: [{ field_id: 1, values: [{ value: '593991234567' }] }],
        _embedded: { leads: [{ id: 902 }] },
      },
      {
        id: 503,
        name: 'No coincide',
        custom_fields_values: [{ field_id: 1, values: [{ value: '0999999999' }] }],
        _embedded: { leads: [{ id: 999 }] },
      },
    ],
  },
};

const unificado = run(unificar, {
  json: {},
  nodes: { 'Preparar Consultas': [{ json: { phone: '+593991234567', local: '991234567', userId: 555 } }] },
  input: [{ json: respuestaContactos }, { json: respuestaContactos }],
})[0].json;

check('unificar: deduplica por id', unificado.contactCount === 2, unificado.contactCount);
check('unificar: descarta teléfonos que no coinciden', !unificado.contactIds.includes(503), JSON.stringify(unificado.contactIds));
check('unificar: junta los leads de todos los contactos', JSON.stringify(unificado.leadIds) === JSON.stringify([900, 901, 902]), JSON.stringify(unificado.leadIds));
check('unificar: toma el nombre del primer contacto', unificado.contactName === 'María Zambrano');

// ---------- Consolidar ----------

const consolidar = snippetOf(verificar, 'Consolidar');
const consolidado = run(consolidar, {
  json: {},
  nodes: {
    'Unificar Contactos': [{ json: unificado }],
    'Usuarios Kommo': [{ json: { _embedded: { users: [{ id: 555, name: 'Asesor UNYX' }, { id: 777, name: 'Otra Asesora' }] } } }],
  },
})[0].json;
check('consolidar: resuelve el subdominio del cliente', consolidado.subdomain === cliente.subdominio, consolidado.subdomain);
check('consolidar: arma el mapa de usuarios', consolidado.userMap[777] === 'Otra Asesora');
check('consolidar: no arrastra mapas de etapas', consolidado.stageMap === undefined);
check(
  'consolidar: respeta pipelinesExcluidos del cliente',
  JSON.stringify(consolidado.pipelinesExcluidos) === JSON.stringify(cliente.pipelinesExcluidos || []),
  JSON.stringify(consolidado.pipelinesExcluidos)
);

// ---------- Evaluar Atención (workflow verificar) ----------

const evaluar = snippetOf(verificar, 'Evaluar Atención');

function evaluarVerificar(leads, userId) {
  const data = Object.assign({}, consolidado, {
    phone: '+593991234567',
    userId,
    contactName: 'María Zambrano',
    contactCount: 1,
    contacts: [{ id: 501, name: 'María Zambrano' }],
    leadIds: leads.map((lead) => lead.id),
  });
  return run(evaluar, {
    json: {},
    nodes: { 'Consolidar': [{ json: data }], 'Obtener Leads': [{ json: { _embedded: { leads } } }] },
  })[0].json;
}

const sinLeads = evaluarVerificar([], 555);
check('evaluar: sin leads -> available', sinLeads.state === 'available', JSON.stringify(sinLeads));

const soloCerrado = evaluarVerificar([{ id: 10, name: 'Ganado', responsible_user_id: 777, created_at: 100, closed_at: 1700000000 }], 555);
check('evaluar: un lead con closed_at no bloquea', soloCerrado.state === 'available', JSON.stringify(soloCerrado.state));
check('evaluar: informa leads cerrados en el historial', soloCerrado.closedLeadCount === 1, soloCerrado.closedLeadCount);

const mio = evaluarVerificar([{ id: 12, name: 'Mío', responsible_user_id: 555, created_at: 100, closed_at: null }], 555);
check('evaluar: lead propio -> same_agent', mio.state === 'same_agent', JSON.stringify(mio));
check('evaluar: arma la URL del lead con el subdominio del cliente', mio.activeLead.leadUrl === 'https://' + cliente.subdominio + '.kommo.com/leads/12', mio.activeLead.leadUrl);

const ajeno = evaluarVerificar([{ id: 13, name: 'Ajeno', responsible_user_id: 777, created_at: 100, closed_at: null }], 555);
check('evaluar: lead de otro -> other_agent', ajeno.state === 'other_agent', JSON.stringify(ajeno));
check('evaluar: resuelve el nombre del asesor', ajeno.activeLead.responsibleName === 'Otra Asesora', ajeno.activeLead.responsibleName);

const varios = evaluarVerificar(
  [
    { id: 14, name: 'Antiguo', responsible_user_id: 555, created_at: 100, closed_at: null },
    { id: 15, name: 'Reciente', responsible_user_id: 777, created_at: 200, closed_at: null },
    { id: 16, name: 'Cerrado', responsible_user_id: 555, created_at: 300, closed_at: 1700000000 },
  ],
  555
);
check('evaluar: dos activos -> multiple_leads', varios.state === 'multiple_leads', JSON.stringify(varios.state));
check('evaluar: lista solo activos, del más reciente al más antiguo', JSON.stringify(varios.leads.map((lead) => lead.id)) === JSON.stringify([15, 14]), JSON.stringify(varios.leads.map((lead) => lead.id)));
check('evaluar: no lista los cerrados', varios.leads.length === 2 && varios.closedLeadCount === 1);

check(
  'evaluar: ignora leads borrados',
  evaluarVerificar([{ id: 17, name: 'Borrado', responsible_user_id: 777, created_at: 100, closed_at: null, is_deleted: true }], 555).state === 'available'
);

const conExclusion = run(evaluar, {
  json: {},
  nodes: {
    'Consolidar': [{ json: Object.assign({}, consolidado, { pipelinesExcluidos: [999] }) }],
    'Obtener Leads': [{ json: { _embedded: { leads: [{ id: 30, name: 'Postventa', responsible_user_id: 777, pipeline_id: 999, created_at: 100, closed_at: null }] } } }],
  },
})[0].json;
check('evaluar: un lead en pipeline excluido no bloquea', conExclusion.state === 'available', JSON.stringify(conExclusion.state));
check('evaluar: el pipeline excluido tampoco cuenta como historial', conExclusion.closedLeadCount === 0, conExclusion.closedLeadCount);

// ---------- Workflow crear ----------

const evaluarCrear = snippetOf(crear, 'Evaluar Atención');
const crearData = Object.assign({}, consolidado, {
  phone: '+593991234567',
  userId: 555,
  userName: 'Asesor UNYX',
  contactName: 'María Zambrano',
  contactCount: 1,
  contacts: [{ id: 501, name: 'María Zambrano' }],
  leadIds: [900],
});

const disponible = run(evaluarCrear, {
  json: {},
  nodes: { 'Consolidar': [{ json: crearData }], 'Obtener Leads': [{ json: { _embedded: { leads: [] } } }] },
})[0].json;
check('crear: disponible reutiliza el contacto', disponible.state === 'available' && disponible.contactId === 501, JSON.stringify(disponible));
check('crear: arma el nombre del lead', disponible.leadName === 'María Zambrano · +593991234567', disponible.leadName);

const ocupado = run(evaluarCrear, {
  json: {},
  nodes: {
    'Consolidar': [{ json: crearData }],
    'Obtener Leads': [{ json: { _embedded: { leads: [{ id: 901, name: 'Activo', responsible_user_id: 777, created_at: 100, closed_at: null }] } } }],
  },
})[0].json;
check('crear: no disponible si hay atención activa', ocupado.state === 'other_agent', JSON.stringify(ocupado.state));

const sinContacto = run(evaluarCrear, {
  json: {},
  nodes: {
    'Consolidar': [{ json: Object.assign({}, crearData, { contactName: '', contacts: [], contactCount: 0, leadIds: [] }) }],
  },
})[0].json;
check('crear: sin contacto previo -> contactId null', sinContacto.contactId === null, JSON.stringify(sinContacto));
check('crear: sin nombre usa el teléfono como nombre', sinContacto.leadName === '+593991234567', sinContacto.leadName);

// ---------- Bloqueado y Resultado ----------

const bloqueado = snippetOf(crear, 'Bloqueado');
const cuerpoBloqueado = run(bloqueado, { json: { state: 'other_agent', activeLead: { id: 1 }, leads: [] } })[0].json;
check('bloqueado: responde ok:false', cuerpoBloqueado.ok === false);
check('bloqueado: mensaje específico para otro asesor', /otro asesor/i.test(cuerpoBloqueado.message), cuerpoBloqueado.message);
check('bloqueado: conserva el estado y el lead', cuerpoBloqueado.state === 'other_agent' && cuerpoBloqueado.activeLead.id === 1);

const resultado = snippetOf(crear, 'Resultado');
const cuerpoCreado = run(resultado, {
  json: { _embedded: { leads: [{ id: 4321 }] } },
  nodes: { 'Evaluar Atención': [{ json: { leadName: 'María Zambrano · +593991234567', contactId: 501 } }] },
})[0].json;
check('resultado: devuelve el lead creado', cuerpoCreado.leadId === 4321 && cuerpoCreado.leadUrl === 'https://' + cliente.subdominio + '.kommo.com/leads/4321', JSON.stringify(cuerpoCreado));

check('inválido: responde ok:false con mensaje', run(snippetOf(crear, 'Teléfono Inválido'), { json: {} })[0].json.ok === false);

// ---------- Coherencia widget <-> workflows ----------

const baseEsperada = 'https://flow.unyxsolutions.com/webhook/unyx-' + cliente.slug;

check('el widget arma la ruta del cliente', widgetScript.includes("var CHECK_PATH = '/verificar-cliente'") && widgetScript.includes("var CREATE_PATH = '/crear-lead'"));
check('el widget lee el ajuste n8n_base', widgetScript.includes('settings.n8n_base'));
check(
  'el widget no trae URL por defecto (evita cruzar cuentas)',
  !/DEFAULT_N8N_URL\s*=\s*'https?:/.test(widgetScript)
);
check('la base documentada coincide con la ruta del workflow', verificar.nodes.some((n) => n.parameters.path === baseEsperada.replace('https://flow.unyxsolutions.com/webhook/', '') + '/verificar-cliente'));

const prepararSnippet = snippetOf(verificar, 'Preparar Consultas');
for (const field of ['phone', 'userId', 'userName']) {
  check('el widget envía ' + field + ' y n8n lo lee', widgetScript.includes(field + ':') && prepararSnippet.includes('body.' + field));
}
check('el widget envía la cuenta para la guarda multi-cliente', widgetScript.includes('account:') && widgetScript.includes("account = context.account"));

const evaluarSnippet = snippetOf(verificar, 'Evaluar Atención');
for (const field of ['state', 'contactName', 'contactCount', 'closedLeadCount', 'activeLead', 'leads']) {
  check('respuesta de n8n incluye ' + field, evaluarSnippet.includes(field));
}
const resultadoSnippet = snippetOf(crear, 'Resultado');
for (const field of ['leadId', 'leadName', 'leadUrl', 'ok']) {
  check('respuesta de creación incluye ' + field, resultadoSnippet.includes(field));
}

// ---------- Resumen ----------

const failed = results.filter((item) => !item.ok);
results.forEach((item) => {
  console.log((item.ok ? 'OK   ' : 'FAIL ') + item.label + (item.detail ? '  → ' + item.detail : ''));
});
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' comprobaciones OK');
process.exit(failed.length ? 1 : 0);
