'use strict';

/**
 * Pruebas de la lógica de los nodos Code y del encapsulado del widget,
 * sin n8n ni navegador. Los snippets se extraen de los JSON generados, así
 * se valida además que build.js los haya incrustado bien.
 *
 * Uso: node unyx/n8n/test/logic.test.js
 */

const fs = require('fs');
const path = require('path');

const N8N_DIR = path.join(__dirname, '..');
const WIDGET_DIR = path.join(N8N_DIR, '..', 'duplicados');

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
const cliente = config.clientes.find((c) => c.slug === 'unyx');
const verificar = loadWorkflow('unyx-verificar-cliente.json');
const crear = loadWorkflow('unyx-crear-lead.json');
const widgetScript = fs.readFileSync(path.join(WIDGET_DIR, 'script.js'), 'utf8');
const widgetCss = fs.readFileSync(path.join(WIDGET_DIR, 'style.css'), 'utf8');

// Las comprobaciones son sobre el código, no sobre los comentarios.
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = sinComentarios(widgetCss);
const js = sinComentarios(widgetScript);

// =============================================================
// 1. Un par de workflows por cliente, sin Switch ni ramas
// =============================================================

check('config: UNYX es la única configuración (la madre)', config.clientes.length === 1 && cliente !== undefined, config.clientes.map((c) => c.slug).join(', '));
check('config: la cuenta madre es unyx.kommo.com', cliente.subdominio === 'unyx', cliente.subdominio);

// Los workflows viven también en n8n: al reexportarlos cambian el id, la
// credencial seleccionada y el token pegado. Las comprobaciones se apoyan en
// la estructura (el webhook), no en esos valores.
function esVerificar(workflow) {
  const wh = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook');
  return Boolean(wh) && String(wh.parameters.path).endsWith('/verificar-cliente');
}

for (const workflow of [verificar, crear]) {
  check(workflow.name + ': no usa Switch', !workflow.nodes.some((node) => node.type === 'n8n-nodes-base.switch'));
  check(workflow.name + ': no usa variables de entorno', !JSON.stringify(workflow).includes('$env'));
  check(
    workflow.name + ': no usa Authorization manual',
    !JSON.stringify(workflow).includes('Bearer {{') && !JSON.stringify(workflow).includes('kommoToken')
  );
  const esperados = esVerificar(workflow) ? 16 : 23;
  check(workflow.name + ': tamaño contenido', workflow.nodes.length === esperados, workflow.nodes.length + ' nodos');
}

// =============================================================
// 2. Estructura de los workflows
// =============================================================

function alcanzables(workflow) {
  const vistos = new Set();
  const pila = ['Webhook Widget'];
  while (pila.length) {
    const actual = pila.pop();
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    for (const rama of (workflow.connections[actual] || { main: [] }).main || []) {
      for (const enlace of rama) pila.push(enlace.node);
    }
  }
  return vistos;
}

for (const workflow of [verificar, crear]) {
  const nombres = new Set(workflow.nodes.map((node) => node.name));
  const rotas = [];
  for (const [desde, salidas] of Object.entries(workflow.connections)) {
    if (!nombres.has(desde)) rotas.push('origen ' + desde);
    for (const rama of salidas.main) {
      for (const enlace of rama) if (!nombres.has(enlace.node)) rotas.push(desde + ' -> ' + enlace.node);
    }
  }
  check(workflow.name + ': conexiones válidas', rotas.length === 0, rotas.join(', '));

  const alcanzados = alcanzables(workflow);
  const sueltos = workflow.nodes
    .filter((node) => node.type !== 'n8n-nodes-base.stickyNote')
    .map((node) => node.name)
    .filter((nombre) => !alcanzados.has(nombre));
  check(workflow.name + ': todos los nodos son alcanzables', sueltos.length === 0, sueltos.slice(0, 5).join(', '));

  const http = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
  check(
    workflow.name + ': todos los HTTP usan credencial de n8n',
    http.length > 0 && http.every((node) => {
      const tipo = node.parameters.genericAuthType;
      return node.parameters.authentication === 'genericCredentialType' && node.credentials && node.credentials[tipo];
    }),
    http.length + ' nodos HTTP'
  );
  check(
    workflow.name + ': todos los HTTP comparten una sola credencial',
    (() => {
      const ids = new Set(http.map((node) => {
        const tipo = node.parameters.genericAuthType;
        return node.credentials[tipo] && node.credentials[tipo].id;
      }));
      return ids.size === 1 && Boolean([...ids][0]);
    })(),
    http.length + ' nodos'
  );
  check(
    workflow.name + ': los HTTP apuntan al subdominio del cliente',
    http.every((node) => String(node.parameters.url || '').includes('https://' + cliente.subdominio + '.kommo.com'))
  );
  check(
    workflow.name + ': usa la ruta documentada de campos de contacto',
    http.every((node) => {
      const url = String(node.parameters.url || '');
      return !url.includes('/contacts/fields') && (!url.includes('custom_fields') || url.includes('/contacts/custom_fields'));
    })
  );
  check(
    workflow.name + ': la lista de usuarios degrada en vez de abortar',
    workflow.nodes
      .filter((node) => node.name === 'Usuarios Kommo')
      .every((node) => node.onError === 'continueRegularOutput' && node.alwaysOutputData === true && !('onError' in node.parameters))
  );
  check(
    workflow.name + ': el webhook no queda abierto a cualquier origen',
    workflow.nodes.every((node) => node.type !== 'n8n-nodes-base.webhook' || !node.parameters.options || node.parameters.options.allowedOrigins === undefined)
  );
  check(
    workflow.name + ': el webhook es el del cliente',
    workflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook').parameters.path ===
      'unyx/' + (esVerificar(workflow) ? 'verificar-cliente' : 'crear-lead')
  );
  check(
    workflow.name + ': no consulta pipelines ni etapas',
    !workflow.nodes.some((node) => String((node.parameters || {}).url || '').includes('/pipelines'))
  );
  check(
    workflow.name + ': las referencias entre nodos existen',
    (() => {
      const referencias = [];
      for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
        for (const m of String(node.parameters.jsCode).matchAll(/\$\('([^']+)'\)/g)) referencias.push(m[1]);
      }
      return referencias.every((nombre) => nombres.has(nombre));
    })()
  );
  check(workflow.name + ': no quedan placeholders de nodo sin resolver', !JSON.stringify(workflow).includes('__N_'));
}

// =============================================================
// 3. Guarda de acceso: token del widget + cuenta
// =============================================================

const autorizadoNode = verificar.nodes.find((node) => node.name === '¿Autorizado?');
const autorizadoExpr = autorizadoNode.parameters.conditions.conditions[0].leftValue
  .replace(/^=/, '').replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
const evaluarAutorizado = new Function('$json', 'return (' + autorizadoExpr + ');');

// El token esperado se lee del propio workflow: es el que el usuario pegó en
// n8n. Así la prueba valida la lógica y no un valor concreto.
const tokenEsperado = (autorizadoExpr.match(/===\s*"([^"]*)"/) || [])[1];
check('autorizado: el workflow tiene un token configurado', Boolean(tokenEsperado), tokenEsperado ? tokenEsperado.slice(0, 4) + '…' : '(vacío)');

const cuerpoOk = { body: { token: tokenEsperado, account: cliente.subdominio, phone: '991234567' } };
check('autorizado: deja pasar el token y la cuenta correctos', evaluarAutorizado(cuerpoOk) === true);
check('autorizado: rechaza un token distinto', evaluarAutorizado({ body: { token: 'otro', account: 'unyx' } }) === false);
check('autorizado: rechaza la cuenta equivocada', evaluarAutorizado({ body: { token: tokenEsperado, account: 'meditecec' } }) === false);
check('autorizado: rechaza si no hay token', evaluarAutorizado({ body: { account: 'unyx' } }) === false);
check('autorizado: rechaza si no hay cuerpo', evaluarAutorizado({}) === false);
check('autorizado: acepta mayúsculas y espacios en la cuenta', evaluarAutorizado({ body: { token: tokenEsperado, account: ' UNYX ' } }) === true);
check('autorizado: responde ok:false al denegar', run(snippetOf(crear, 'Acceso Denegado'), { json: {} })[0].json.ok === false);
check('autorizado: el mensaje de denegación no revela el token', !run(snippetOf(crear, 'Acceso Denegado'), { json: {} })[0].json.message.includes(String(tokenEsperado)));

// =============================================================
// 4. Lógica de los nodos
// =============================================================

const preparar = snippetOf(verificar, 'Preparar Consultas');
check('preparar: acepta 991234567', run(preparar, { json: { body: { phone: '991234567', userId: '77' } } })[0].json.phone === '+593991234567');
const variantes = run(preparar, { json: { body: { phone: '0991234567', userId: 77, userName: 'Ana' } } });
check('preparar: genera 3 variantes', variantes.length === 3, JSON.stringify(variantes.map((i) => i.json.variant)));
check('preparar: variantes correctas', JSON.stringify(variantes.map((i) => i.json.variant)) === JSON.stringify(['991234567', '0991234567', '+593991234567']));
check('preparar: conserva el asesor', variantes[0].json.userId === 77 && variantes[0].json.userName === 'Ana');
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
check('preparar: tolera un payload sin envoltorio body', run(preparar, { json: { phone: '991234567', userId: 1 } })[0].json.phone === '+593991234567');

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

const consolidar = snippetOf(verificar, 'Consolidar');
const consolidado = run(consolidar, {
  json: {},
  nodes: {
    'Unificar Contactos': [{ json: unificado }],
    'Usuarios Kommo': [{ json: { _embedded: { users: [{ id: 77, name: 'Asesor UNYX' }, { id: 88, name: 'Otra Asesora' }] } } }],
  },
})[0].json;
check('consolidar: usa el subdominio del cliente', consolidado.subdomain === 'unyx', consolidado.subdomain);
check('consolidar: arma el mapa de usuarios', consolidado.userMap[88] === 'Otra Asesora');
check('consolidar: incluye los pipelines excluidos', JSON.stringify(consolidado.pipelinesExcluidos) === JSON.stringify(cliente.pipelinesExcluidos));

const evaluar = snippetOf(verificar, 'Evaluar Atención');

function evaluarVerificar(leads, userId, extra) {
  const base = Object.assign({}, consolidado, {
    phone: '+593991234567',
    userId,
    contactName: 'María Zambrano',
    contactCount: 1,
    contacts: [{ id: 501, name: 'María Zambrano' }],
    leadIds: leads.map((lead) => lead.id),
  }, extra || {});
  return run(evaluar, {
    json: {},
    nodes: { 'Consolidar': [{ json: base }], 'Obtener Leads': [{ json: { _embedded: { leads } } }] },
  })[0].json;
}

check('evaluar: sin leads -> available', evaluarVerificar([], 77).state === 'available');
check(
  'evaluar: un lead con closed_at no bloquea',
  evaluarVerificar([{ id: 10, name: 'Ganado', responsible_user_id: 88, created_at: 100, closed_at: 1700000000 }], 77).state === 'available'
);
check(
  'evaluar: informa leads cerrados en el historial',
  evaluarVerificar([{ id: 10, responsible_user_id: 88, created_at: 100, closed_at: 1700000000 }], 77).closedLeadCount === 1
);
const mio = evaluarVerificar([{ id: 12, name: 'Mío', responsible_user_id: 77, created_at: 100, closed_at: null }], 77);
check('evaluar: lead propio -> same_agent', mio.state === 'same_agent', JSON.stringify(mio));
check('evaluar: arma la URL con el subdominio del cliente', mio.activeLead.leadUrl === 'https://unyx.kommo.com/leads/12', mio.activeLead.leadUrl);
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
check('evaluar: lista sólo activos, del más reciente al más antiguo', JSON.stringify(varios.leads.map((lead) => lead.id)) === JSON.stringify([15, 14]));
check(
  'evaluar: ignora leads borrados',
  evaluarVerificar([{ id: 17, responsible_user_id: 88, created_at: 100, closed_at: null, is_deleted: true }], 77).state === 'available'
);
const conExclusion = evaluarVerificar(
  [
    { id: 30, name: 'Postventa', responsible_user_id: 88, pipeline_id: 999, created_at: 300, closed_at: 1700000000 },
    { id: 33, name: 'Ganado de ventas', responsible_user_id: 88, pipeline_id: 1, created_at: 200, closed_at: 1700000000 },
  ],
  77,
  { pipelinesExcluidos: [999] }
);
check('evaluar: un lead de pipeline excluido no bloquea', conExclusion.state === 'available');
check('evaluar: el cerrado excluido NO cuenta como historial', conExclusion.closedLeadCount === 1, conExclusion.closedLeadCount);

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
    'Obtener Leads': [{ json: { _embedded: { leads: [{ id: 901, responsible_user_id: 88, created_at: 100, closed_at: null }] } } }],
  },
})[0].json;
check('crear: no disponible si hay atención activa', ocupado.state === 'other_agent', JSON.stringify(ocupado.state));
const sinContacto = run(evaluarCrear, {
  json: {},
  nodes: { 'Consolidar': [{ json: Object.assign({}, crearData, { contactName: '', contacts: [], contactCount: 0, leadIds: [] }) }] },
})[0].json;
check('crear: sin contacto previo -> contactId null', sinContacto.contactId === null);
check('crear: sin nombre usa el teléfono', sinContacto.leadName === '+593991234567');

const cuerpoBloqueado = run(snippetOf(crear, 'Bloqueado'), { json: { state: 'other_agent', activeLead: { id: 1 }, leads: [] } })[0].json;
check('bloqueado: responde ok:false', cuerpoBloqueado.ok === false);
check('bloqueado: mensaje específico para otro asesor', /otro asesor/i.test(cuerpoBloqueado.message));

const cuerpoCreado = run(snippetOf(crear, 'Resultado'), {
  json: { _embedded: { leads: [{ id: 4321 }] } },
  nodes: { 'Evaluar Atención': [{ json: { leadName: 'X · +593991234567', contactId: 501 } }] },
})[0].json;
check('resultado: devuelve el lead con la URL del cliente', cuerpoCreado.leadId === 4321 && cuerpoCreado.leadUrl === 'https://unyx.kommo.com/leads/4321', JSON.stringify(cuerpoCreado));

check('inválido: responde ok:false', run(snippetOf(crear, 'Teléfono Inválido'), { json: {} })[0].json.ok === false);

// =============================================================
// 5. Widget: encapsulado del CSS y del DOM (el bug de Kommo)
// =============================================================

const selectoresGlobales = [':root', 'body', 'html'].filter((sel) =>
  new RegExp('(^|[,}\\s])' + sel + '\\s*[,{]', 'm').test(css)
);
check('css: sin selectores globales (:root/body/html)', selectoresGlobales.length === 0, selectoresGlobales.join(', '));
check('css: sin comodín universal suelto', !/(^|[,}\s])\*\s*[,{]/.test(css.replace(/\.unyx-widget \*/g, '')));

const reglas = css
  .split('}')
  .map((bloque) => (bloque.split('{')[0] || '').trim())
  .filter((sel) => sel && !sel.startsWith('@'));
const sinPrefijo = reglas.filter((sel) => !sel.split(',').every((parte) => parte.trim().startsWith('.unyx-widget')));
check('css: todo selector arranca por .unyx-widget', sinPrefijo.length === 0, sinPrefijo.slice(0, 3).join(' | '));
check('css: los keyframes llevan prefijo', [...css.matchAll(/@keyframes\s+([\w-]+)/g)].every((m) => m[1].startsWith('unyx-')));

const clasesMarkup = new Set([...widgetScript.matchAll(/class="(unyx-[^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
const clasesCss = new Set([...css.matchAll(/\.(unyx-[a-z0-9-]+)/g)].map((m) => m[1]));
const faltantes = [...clasesMarkup].filter((c) => !clasesCss.has(c));
check('css: toda clase del markup está definida', faltantes.length === 0, faltantes.join(', '));
const variantesEstado = ['success', 'warning', 'error', 'blocked', 'info'];
check('css: están las 5 variantes de estado', variantesEstado.every((v) => clasesCss.has('unyx-status--' + v)));
check('css: el estado base se aplica junto con la variante', /["']unyx-status unyx-status--["'] \+ kind/.test(widgetScript));

check('script: no inyecta el CSS en document.head', !js.includes('document.head'));
check('script: no toca document.body ni documentElement', !/document\.(body|documentElement)/.test(js));
check('script: no usa window', !/\bwindow\./.test(js));
check('script: no usa selectores globales', !/document\.querySelector\(/.test(js));
check('script: la hoja de estilos va dentro del markup del widget', /data-unyx="style"/.test(widgetScript) && /href="' \+\s*esc\(styleHref\(\)\)/.test(widgetScript));
check('script: encapsula cada instancia con un id único', /var instanceId = ["']unyx-root-["'] \+ Math\.random\(\)/.test(widgetScript) && /getElementById\(instanceId\)/.test(widgetScript));
check('script: devuelve false en las fichas de creación', /current_card\.id === 0\s*\)\s*\{\s*return false;/.test(widgetScript));
check('script: usa el ciclo de vida documentado y devuelve true', /render: function \(\) \{[\s\S]*?return true;\s*\}/.test(widgetScript) && /init: function \(\) \{[\s\S]*?return true;\s*\}/.test(widgetScript));
check('script: no usa self.on (no está en la documentación)', !/self\.on\(/.test(js));

// --- Contexto del asesor: se lee en init(), no en render() ---
const tramoRender = js.slice(js.indexOf('render: function'), js.indexOf('init: function'));
const tramoInit = js.slice(js.indexOf('init: function'), js.indexOf('bind_actions: function'));
check('contexto: render() no lee el contexto', tramoRender.length > 0 && !tramoRender.includes('getContext()'), tramoRender.length + ' caracteres');
check('contexto: init() lee el contexto', /refreshContext\(["']init["']\)/.test(tramoInit));
check('contexto: se reintenta antes de verificar', /refreshContext\(["']verify["']\)/.test(js));
check(
  'contexto: usa self.system() como fuente documentada',
  /typeof widgetSelf\.system === ["']function["']/.test(js) && /widgetSelf\.system\(\)/.test(js)
);
check('contexto: tiene respaldo en APP.data', /APP && APP\.data/.test(js) && /app\.user_id/.test(js));
check('contexto: el subdominio cae al hostname de Kommo', /\.kommo\\?\.com\$\/i\.test\(location\.hostname\)/.test(js));
check('contexto: no pisa con vacío un valor ya resuelto', /if \(context\.account\) account = context\.account;/.test(js) && /if \(context\.userId(?: > 0)?\) userId = context\.userId;/.test(js));
check('contexto: registra el contexto sin exponer secretos', /\[UNYX\] Contexto detectado/.test(js) && !/console\.log\([^)]*(token|sharedToken|secreto)/i.test(js));
check('contexto: no hay console.log fuera del diagnóstico', (js.match(/console\.log/g) || []).length === 1, (js.match(/console\.log/g) || []).length + ' llamadas');

// --- Hoja de estilos: se resuelve también en init() ---
check('css: el <link> lleva data-unyx para poder re-resolverlo', /<link rel="stylesheet" data-unyx="style"/.test(widgetScript));
check('css: init() vuelve a resolver el href', /var link = el\(["']style["']\);/.test(js) && /link\.setAttribute\(["']href["'], href\)/.test(js));

// --- Tema claro forzado ---
check('tema: el widget fija color-scheme light', (css.match(/color-scheme: light/g) || []).length >= 4, (css.match(/color-scheme: light/g) || []).length + ' declaraciones');
check('tema: el fondo del widget es explícito', /\.unyx-widget \{[\s\S]*?background: #ffffff !important;/.test(css));
check('tema: el color de texto del widget es explícito', /\.unyx-widget \{[\s\S]*?color: #2E3640 !important;/.test(css));
for (const [nombre, patron] of [
  ['label', /\.unyx-widget \.unyx-label \{[\s\S]*?color: #2E3640 !important;/],
  ['hint', /\.unyx-widget \.unyx-hint \{[\s\S]*?color: #7a8591 !important;/],
  ['input', /\.unyx-widget \.unyx-phone input \{[\s\S]*?background: #ffffff !important;[\s\S]*?color: #2E3640 !important;/],
  ['prefijo', /\.unyx-widget \.unyx-prefix \{[\s\S]*?background: #f2f4f7 !important;[\s\S]*?color: #2E3640 !important;/],
  ['botón', /\.unyx-widget \.unyx-button \{[\s\S]*?background: #1a3bbd !important;[\s\S]*?color: #ffffff !important;/],
  ['botón secundario', /\.unyx-widget \.unyx-button\.unyx-secondary \{[\s\S]*?background: #f2f4f7 !important;[\s\S]*?color: #2E3640 !important;/],
  ['error', /\.unyx-widget \.unyx-error-text \{[\s\S]*?color: #d92d20 !important;/],
  ['link', /\.unyx-widget \.unyx-link,[\s\S]*?\.unyx-link:visited \{[\s\S]*?color: #1a3bbd !important;/]
]) {
  check('tema: color explícito en ' + nombre, patron.test(css));
}
check('tema: las variantes de estado van después de la base', css.indexOf('.unyx-status--success') > css.indexOf('.unyx-widget .unyx-status {'));


// =============================================================
// 6. Coherencia widget <-> workflows
// =============================================================

check('el widget usa las rutas del cliente', /var CHECK_PATH = ["']\/verificar-cliente["']/.test(widgetScript) && /var CREATE_PATH = ["']\/crear-lead["']/.test(widgetScript));
check('el widget lee n8n_base y unyx_token', widgetScript.includes('settings.n8n_base') && widgetScript.includes('settings.unyx_token'));
check('el widget envía el token en las dos llamadas', (widgetScript.match(/token: sharedToken/g) || []).length === 2);
check('el widget no trae URL por defecto', !/DEFAULT_N8N_URL\s*=\s*'https?:/.test(widgetScript));
check('el widget envía el subdominio como account', /account: account/.test(widgetScript));

// =============================================================
// Resumen
// =============================================================

const failed = results.filter((item) => !item.ok);
results.forEach((item) => {
  console.log((item.ok ? 'OK   ' : 'FAIL ') + item.label + (item.detail ? '  → ' + item.detail : ''));
});
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' comprobaciones OK');
process.exit(failed.length ? 1 : 0);
