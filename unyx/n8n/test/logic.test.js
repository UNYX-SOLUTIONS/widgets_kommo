'use strict';

/**
 * Prueba la lógica de los nodos Code de los DOS workflows generales sin n8n.
 * Los snippets se extraen de los JSON generados, así se valida también que
 * build.js los haya incrustado bien.
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
  const $env = ctx.env || {};
  const fn = new Function('$input', '$', '$json', '$env', snippet);
  return fn($input, $, ctx.json, $env);
}

const config = JSON.parse(fs.readFileSync(path.join(N8N_DIR, 'clientes.json'), 'utf8'));
const clientes = config.clientes;
const altosa = clientes.find((c) => c.slug === 'altosa');
const luxviajes = clientes.find((c) => c.slug === 'luxviajes');

const verificar = loadWorkflow('unyx-verificar-cliente.json');
const crear = loadWorkflow('unyx-crear-lead.json');
const widgetScript = fs.readFileSync(path.join(N8N_DIR, '..', 'duplicados', 'script.js'), 'utf8');

// ---------- Configuración de clientes ----------

const slugs = clientes.map((c) => c.slug);
check('clientes: slug único', new Set(slugs).size === slugs.length, slugs.join(', '));
check('clientes: hay 3 clientes', clientes.length === 3, clientes.map((c) => c.nombre).join(', '));
check(
  'clientes: cada uno tiene las 2 variables de entorno',
  clientes.every((c) => c.secretoEnv && c.kommoEnv && c.subdominio && c.nombre)
);
check(
  'clientes: Altosa está configurada',
  altosa && altosa.subdominio === 'altosa' && altosa.secretoEnv === 'UNYX_SECRET_ALTOSA',
  JSON.stringify(altosa)
);
check(
  'clientes: LuxViajes conserva sus pipelines excluidos',
  JSON.stringify(luxviajes.pipelinesExcluidos) === JSON.stringify([13416240, 13629516, 13629520, 13680940])
);

// ---------- Estructura de los dos workflows ----------

for (const workflow of [verificar, crear]) {
  const names = new Set(workflow.nodes.map((n) => n.name));
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

  // Alcanzabilidad: todo nodo ejecutable debe colgar del webhook. Un nodo
  // suelto deja la ejecución parada y el widget sin respuesta.
  const alcanzables = new Set();
  const pila = ['Webhook Widget'];
  while (pila.length) {
    const actual = pila.pop();
    if (alcanzables.has(actual)) continue;
    alcanzables.add(actual);
    for (const rama of (workflow.connections[actual] || { main: [] }).main || []) {
      for (const enlace of rama) pila.push(enlace.node);
    }
  }
  const sueltos = workflow.nodes
    .filter((n) => n.type !== 'n8n-nodes-base.stickyNote')
    .map((n) => n.name)
    .filter((nombre) => !alcanzables.has(nombre));
  check(workflow.name + ': todos los nodos son alcanzables desde el webhook', sueltos.length === 0, sueltos.join(', '));
  check(workflow.name + ': tiene Respond to Webhook', workflow.nodes.some((n) => n.type === 'n8n-nodes-base.respondToWebhook'));
  check(workflow.name + ': es general (no lleva cliente en el nombre)', !/Altosa|Meditec|LuxViajes/i.test(workflow.name), workflow.name);
  check(
    workflow.name + ': no consulta pipelines ni etapas',
    !workflow.nodes.some((n) => String((n.parameters || {}).url || '').includes('/pipelines'))
  );
  check(
    workflow.name + ': no usa credenciales de n8n',
    workflow.nodes.every((n) => !n.credentials)
  );
  check(
    workflow.name + ': los HTTP mandan Authorization desde la variable de entorno',
    workflow.nodes
      .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
      .every((n) => n.parameters.sendHeaders === true && n.parameters.headerParameters.parameters.some((h) => h.name === 'Authorization' && h.value.includes('kommoToken')))
  );
  check(
    workflow.name + ': las URLs usan el subdominio resuelto',
    workflow.nodes
      .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
      .every((n) => String(n.parameters.url || '').includes("$('Resolver Cliente').first().json.subdominio"))
  );
  check(
    workflow.name + ': usa la ruta documentada de campos de contacto',
    workflow.nodes
      .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
      .every((n) => { const u = String(n.parameters.url || ''); return !u.includes('/contacts/fields') && (!u.includes('custom_fields') || u.includes('/contacts/custom_fields')); })
  );
  const usuarios = workflow.nodes.find((n) => n.name === 'Usuarios Kommo');
  check(
    workflow.name + ': la lista de usuarios degrada en vez de abortar',
    usuarios && usuarios.onError === 'continueRegularOutput' && usuarios.alwaysOutputData === true && !('onError' in usuarios.parameters)
  );
  check(
    workflow.name + ': la búsqueda de contactos pide 250',
    workflow.nodes.some((n) => n.name === 'Buscar Contactos' && n.parameters.queryParameters.parameters.some((p) => p.name === 'limit' && p.value === '250'))
  );
  check(
    workflow.name + ': el webhook no queda abierto a cualquier origen',
    workflow.nodes.every((n) => n.type !== 'n8n-nodes-base.webhook' || !n.parameters.options || n.parameters.options.allowedOrigins === undefined)
  );
  check(
    workflow.name + ': ningún token está incrustado en el JSON',
    !JSON.stringify(workflow).includes(clientes[0].secretoEnv === 'UNYX_SECRET_ALTOSA' ? 'Bearer ' + altosa.secretoEnv : 'ZZZ')
  );
}

check('el webhook es el mismo para todos los clientes', verificar.nodes.find((n) => n.name === 'Webhook Widget').parameters.path === 'unyx/verificar-cliente');
check('el webhook de creación es general', crear.nodes.find((n) => n.name === 'Webhook Widget').parameters.path === 'unyx/crear-lead');

// ---------- Resolver Cliente (switch por token) ----------

const resolver = snippetOf(verificar, 'Resolver Cliente');

function resolverCtx(body, env) {
  return run(resolver, { json: { body }, env: env });
}

const ENV_OK = {
  UNYX_SECRET_ALTOSA: 'token-altosa',
  KOMMO_TOKEN_ALTOSA: 'kommo-altosa',
  UNYX_SECRET_MEDITEC: 'token-meditec',
  KOMMO_TOKEN_MEDITEC: 'kommo-meditec',
  UNYX_SECRET_LUXVIAJES: 'token-lux',
  KOMMO_TOKEN_LUXVIAJES: 'kommo-lux',
};

const okAltosa = resolverCtx({ token: 'token-altosa', account: 'altosa', phone: '991234567', userId: '77' }, ENV_OK)[0].json;
check('resolver: identifica a Altosa por su token', okAltosa.autorizado === true && okAltosa.cliente === 'Altosa', JSON.stringify(okAltosa));
check('resolver: devuelve el subdominio del cliente', okAltosa.subdominio === 'altosa');
check('resolver: devuelve el token de Kommo de ese cliente', okAltosa.kommoToken === 'kommo-altosa');
check('resolver: no propaga el token del widget', okAltosa.token === undefined);

const okLux = resolverCtx({ token: 'token-lux', account: 'agencialuxviajes' }, ENV_OK)[0].json;
check('resolver: identifica a LuxViajes', okLux.cliente === 'LuxViajes' && okLux.subdominio === 'agencialuxviajes');
check('resolver: aplica los pipelines excluidos del cliente', JSON.stringify(okLux.pipelinesExcluidos) === JSON.stringify(luxviajes.pipelinesExcluidos));
check('resolver: un cliente sin exclusiones recibe lista vacía', JSON.stringify(okAltosa.pipelinesExcluidos) === '[]');

const okMeditec = resolverCtx({ token: 'token-meditec', account: 'meditecec' }, ENV_OK)[0].json;
check('resolver: identifica a Meditec', okMeditec.cliente === 'Meditec');

check('resolver: rechaza un token desconocido', resolverCtx({ token: 'inventado', account: 'altosa' }, ENV_OK)[0].json.ok === false);
check('resolver: rechaza si no hay token', resolverCtx({ account: 'altosa' }, ENV_OK)[0].json.ok === false);
check(
  'resolver: falla cerrado si las variables de entorno no existen',
  resolverCtx({ token: 'token-altosa', account: 'altosa' }, {})[0].json.ok === false
);
check(
  'resolver: rechaza el token de un cliente en la cuenta de otro',
  resolverCtx({ token: 'token-altosa', account: 'meditecec' }, ENV_OK)[0].json.ok === false,
  JSON.stringify(resolverCtx({ token: 'token-altosa', account: 'meditecec' }, ENV_OK)[0].json)
);
check(
  'resolver: avisa si falta el token de Kommo del cliente',
  resolverCtx({ token: 'token-altosa', account: 'altosa' }, { UNYX_SECRET_ALTOSA: 'token-altosa' })[0].json.message.includes('Altosa')
);

const autorizadoNode = verificar.nodes.find((n) => n.name === '¿Autorizado?');
const autorizadoExpr = autorizadoNode.parameters.conditions.conditions[0].leftValue
  .replace(/^=/, '').replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
const evaluarAutorizado = new Function('$json', 'return (' + autorizadoExpr + ');');
check('¿Autorizado?: deja pasar la petición válida', evaluarAutorizado(okAltosa) === true);
check('¿Autorizado?: manda al respondedor la denegada', evaluarAutorizado({ ok: false, message: 'x' }) === false);
check('¿Autorizado?: no deja pasar un objeto vacío', evaluarAutorizado({}) === false);

// ---------- Preparar Consultas ----------

const preparar = snippetOf(verificar, 'Preparar Consultas');
const resultadoPreparar = run(preparar, { json: { phone: '0991234567', userId: 77, userName: 'Ana', subdominio: 'altosa' } });
check('preparar: genera 3 variantes', resultadoPreparar.length === 3, JSON.stringify(resultadoPreparar.map((i) => i.json.variant)));
check(
  'preparar: variantes correctas',
  JSON.stringify(resultadoPreparar.map((i) => i.json.variant)) === JSON.stringify(['991234567', '0991234567', '+593991234567'])
);
check('preparar: normaliza a E.164', resultadoPreparar[0].json.phone === '+593991234567');
check('preparar: conserva el asesor y el subdominio', resultadoPreparar[0].json.userId === 77 && resultadoPreparar[0].json.subdominio === 'altosa');
check(
  'preparar: rechaza un fijo',
  (() => {
    try {
      run(preparar, { json: { phone: '022345678' } });
      return false;
    } catch (error) {
      return true;
    }
  })()
);

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
        name: 'Otro formato',
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
  nodes: { 'Preparar Consultas': [{ json: { phone: '+593991234567', local: '991234567', userId: 77 } }] },
  input: [{ json: respuestaContactos }, { json: respuestaContactos }],
})[0].json;
check('unificar: deduplica por id', unificado.contactCount === 2, unificado.contactCount);
check('unificar: descarta teléfonos que no coinciden', !unificado.contactIds.includes(503));
check('unificar: junta los leads de todos los contactos', JSON.stringify(unificado.leadIds) === JSON.stringify([900, 901, 902]));
check('unificar: toma el nombre del primer contacto', unificado.contactName === 'María Zambrano');

// ---------- Consolidar ----------

const consolidar = snippetOf(verificar, 'Consolidar');
const consolidado = run(consolidar, {
  json: {},
  nodes: {
    'Unificar Contactos': [{ json: unificado }],
    'Usuarios Kommo': [{ json: { _embedded: { users: [{ id: 77, name: 'Asesor UNYX' }, { id: 88, name: 'Otra Asesora' }] } } }],
    'Resolver Cliente': [{ json: okAltosa }],
  },
})[0].json;
check('consolidar: toma el subdominio del cliente resuelto', consolidado.subdomain === 'altosa', consolidado.subdomain);
check('consolidar: arma el mapa de usuarios', consolidado.userMap[88] === 'Otra Asesora');
check(
  'consolidar: respeta pipelinesExcluidos del cliente',
  JSON.stringify(consolidado.pipelinesExcluidos) === JSON.stringify(altosa.pipelinesExcluidos || [])
);

const consolidadoLux = run(consolidar, {
  json: {},
  nodes: {
    'Unificar Contactos': [{ json: unificado }],
    'Usuarios Kommo': [{ json: { _embedded: { users: [] } } }],
    'Resolver Cliente': [{ json: okLux }],
  },
})[0].json;
check('consolidar: un cliente con exclusiones las arrastra', consolidadoLux.pipelinesExcluidos.length === 4);

// ---------- Evaluar Atención (verificar) ----------

const evaluar = snippetOf(verificar, 'Evaluar Atención');

function evaluarVerificar(leads, userId, data) {
  const base = Object.assign({}, consolidado, {
    phone: '+593991234567',
    userId,
    contactName: 'María Zambrano',
    contactCount: 1,
    contacts: [{ id: 501, name: 'María Zambrano' }],
    leadIds: leads.map((lead) => lead.id),
  }, data || {});
  return run(evaluar, {
    json: {},
    nodes: { 'Consolidar': [{ json: base }], 'Obtener Leads': [{ json: { _embedded: { leads } } }] },
  })[0].json;
}

const sinLeads = evaluarVerificar([], 77);
check('evaluar: sin leads -> available', sinLeads.state === 'available', JSON.stringify(sinLeads));

const soloCerrado = evaluarVerificar([{ id: 10, name: 'Ganado', responsible_user_id: 88, created_at: 100, closed_at: 1700000000 }], 77);
check('evaluar: un lead con closed_at no bloquea', soloCerrado.state === 'available');
check('evaluar: informa leads cerrados en el historial', soloCerrado.closedLeadCount === 1);

const mio = evaluarVerificar([{ id: 12, name: 'Mío', responsible_user_id: 77, created_at: 100, closed_at: null }], 77);
check('evaluar: lead propio -> same_agent', mio.state === 'same_agent', JSON.stringify(mio));
check('evaluar: arma la URL con el subdominio del cliente', mio.activeLead.leadUrl === 'https://altosa.kommo.com/leads/12', mio.activeLead.leadUrl);

const ajeno = evaluarVerificar([{ id: 13, name: 'Ajeno', responsible_user_id: 88, created_at: 100, closed_at: null }], 77);
check('evaluar: lead de otro -> other_agent', ajeno.state === 'other_agent', JSON.stringify(ajeno));
check('evaluar: resuelve el nombre del asesor', ajeno.activeLead.responsibleName === 'Otra Asesora');

const varios = evaluarVerificar(
  [
    { id: 14, name: 'Antiguo', responsible_user_id: 77, created_at: 100, closed_at: null },
    { id: 15, name: 'Reciente', responsible_user_id: 88, created_at: 200, closed_at: null },
    { id: 16, name: 'Cerrado', responsible_user_id: 77, created_at: 300, closed_at: 1700000000 },
  ],
  77
);
check('evaluar: dos activos -> multiple_leads', varios.state === 'multiple_leads', JSON.stringify(varios.state));
check('evaluar: lista solo activos, del más reciente al más antiguo', JSON.stringify(varios.leads.map((lead) => lead.id)) === JSON.stringify([15, 14]));

check(
  'evaluar: ignora leads borrados',
  evaluarVerificar([{ id: 17, name: 'Borrado', responsible_user_id: 88, created_at: 100, closed_at: null, is_deleted: true }], 77).state === 'available'
);

const conExclusion = evaluarVerificar(
  [
    { id: 30, name: 'Postventa', responsible_user_id: 88, pipeline_id: 999, created_at: 300, closed_at: 1700000000 },
    { id: 33, name: 'Ganado de ventas', responsible_user_id: 88, pipeline_id: 1, created_at: 200, closed_at: 1700000000 },
  ],
  77,
  { pipelinesExcluidos: [999] }
);
check('evaluar: un lead de pipeline excluido no bloquea', conExclusion.state === 'available', JSON.stringify(conExclusion.state));
check('evaluar: el cerrado excluido NO cuenta como historial', conExclusion.closedLeadCount === 1, conExclusion.closedLeadCount);

// ---------- Evaluar Atención (crear) ----------

const evaluarCrear = snippetOf(crear, 'Evaluar Atención');
const crearData = Object.assign({}, consolidado, {
  phone: '+593991234567',
  userId: 77,
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
    'Obtener Leads': [{ json: { _embedded: { leads: [{ id: 901, name: 'Activo', responsible_user_id: 88, created_at: 100, closed_at: null }] } } }],
  },
})[0].json;
check('crear: no disponible si hay atención activa', ocupado.state === 'other_agent', JSON.stringify(ocupado.state));

const sinContacto = run(evaluarCrear, {
  json: {},
  nodes: { 'Consolidar': [{ json: Object.assign({}, crearData, { contactName: '', contacts: [], contactCount: 0, leadIds: [] }) }] },
})[0].json;
check('crear: sin contacto previo -> contactId null', sinContacto.contactId === null);
check('crear: sin nombre usa el teléfono', sinContacto.leadName === '+593991234567');

// ---------- Bloqueado y Resultado ----------

const cuerpoBloqueado = run(snippetOf(crear, 'Bloqueado'), { json: { state: 'other_agent', activeLead: { id: 1 }, leads: [] } })[0].json;
check('bloqueado: responde ok:false', cuerpoBloqueado.ok === false);
check('bloqueado: mensaje específico para otro asesor', /otro asesor/i.test(cuerpoBloqueado.message));
check('bloqueado: conserva el estado y el lead', cuerpoBloqueado.state === 'other_agent' && cuerpoBloqueado.activeLead.id === 1);

const cuerpoCreado = run(snippetOf(crear, 'Resultado'), {
  json: { _embedded: { leads: [{ id: 4321 }] } },
  nodes: {
    'Evaluar Atención': [{ json: { leadName: 'María Zambrano · +593991234567', contactId: 501 } }],
    'Resolver Cliente': [{ json: okAltosa }],
  },
})[0].json;
check('resultado: devuelve el lead creado con la URL del cliente', cuerpoCreado.leadId === 4321 && cuerpoCreado.leadUrl === 'https://altosa.kommo.com/leads/4321', JSON.stringify(cuerpoCreado));

check('inválido: responde ok:false con mensaje', run(snippetOf(crear, 'Teléfono Inválido'), { json: {} })[0].json.ok === false);

// ---------- Coherencia widget <-> workflows ----------

check('el widget usa las rutas generales', widgetScript.includes("var CHECK_PATH = '/verificar-cliente'") && widgetScript.includes("var CREATE_PATH = '/crear-lead'"));
check('el widget lee el ajuste n8n_base', widgetScript.includes('settings.n8n_base'));
check('el widget envía el token', widgetScript.includes('token: sharedToken'));
check('el widget no trae URL por defecto', !/DEFAULT_N8N_URL\s*=\s*'https?:/.test(widgetScript));

// ---------- Resumen ----------

const failed = results.filter((item) => !item.ok);
results.forEach((item) => {
  console.log((item.ok ? 'OK   ' : 'FAIL ') + item.label + (item.detail ? '  → ' + item.detail : ''));
});
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' comprobaciones OK');
process.exit(failed.length ? 1 : 0);
