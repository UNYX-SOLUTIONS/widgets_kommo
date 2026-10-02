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
const clientes = config.clientes;
const meditec = clientes.find((c) => c.slug === 'meditec');
const altosa = clientes.find((c) => c.slug === 'altosa');
const luxviajes = clientes.find((c) => c.slug === 'luxviajes');

const verificar = loadWorkflow('unyx-verificar-cliente.json');
const crear = loadWorkflow('unyx-crear-lead.json');
const widgetScript = fs.readFileSync(path.join(WIDGET_DIR, 'script.js'), 'utf8');
const widgetCss = fs.readFileSync(path.join(WIDGET_DIR, 'style.css'), 'utf8');

// Las comprobaciones son sobre el código, no sobre los comentarios.
const sinComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = sinComentarios(widgetCss);
const js = sinComentarios(widgetScript);

const n = (cliente, nombre) => cliente.nombre + ' · ' + nombre;

// =============================================================
// 1. Widget: encapsulado del CSS y del DOM (el bug de Kommo)
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
check(
  'css: los keyframes llevan prefijo',
  [...css.matchAll(/@keyframes\s+([\w-]+)/g)].every((m) => m[1].startsWith('unyx-'))
);

const clasesMarkup = new Set(
  [...widgetScript.matchAll(/class="(unyx-[^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
);
const clasesCss = new Set([...css.matchAll(/\.(unyx-[a-z0-9-]+)/g)].map((m) => m[1]));
const faltantes = [...clasesMarkup].filter((c) => !clasesCss.has(c));
check('css: toda clase del markup está definida', faltantes.length === 0, faltantes.join(', '));

const variantesEstado = ['success', 'warning', 'error', 'blocked', 'info'];
const variantesFaltantes = variantesEstado.filter((v) => !clasesCss.has('unyx-status--' + v));
check('css: están las 5 variantes de estado', variantesFaltantes.length === 0, variantesFaltantes.join(', '));
check('css: el estado base se aplica junto con la variante', /'unyx-status unyx-status--' \+ kind/.test(widgetScript));

check('script: no inyecta el CSS en document.head', !js.includes('document.head'));
check('script: no toca document.body ni documentElement', !/document\.(body|documentElement)/.test(js));
check('script: no usa window', !/\bwindow\./.test(js));
check('script: no usa selectores de clase globales', !/document\.querySelector\(/.test(js));
check('script: la hoja de estilos va dentro del markup del widget', /<link rel="stylesheet" href="' \+ esc\(styleHref\(\)\)/.test(widgetScript));
check(
  'script: encapsula cada instancia con un id único',
  /var instanceId = 'unyx-root-' \+ Math\.random\(\)/.test(widgetScript) && /getElementById\(instanceId\)/.test(widgetScript)
);
check(
  'script: devuelve false en las fichas de creación',
  /current_card\.id === 0\)\s*\{\s*return false;/.test(widgetScript)
);
check(
  'script: usa el ciclo de vida documentado y devuelve true',
  /render: function \(\) \{[\s\S]*?return true;\s*\}/.test(widgetScript) && /init: function \(\) \{[\s\S]*?return true;\s*\}/.test(widgetScript)
);
check('script: no usa self.on (no está en la documentación)', !/self\.on\(/.test(js));
check('script: no imprime tokens en consola', !/console\.log/.test(widgetScript));

// =============================================================
// 2. Estructura de los dos workflows
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

  check(workflow.name + ': tiene Switch Cliente', workflow.nodes.some((node) => node.name === 'Switch Cliente' && node.type === 'n8n-nodes-base.switch'));
  check(workflow.name + ': no queda Resolver Cliente', !workflow.nodes.some((node) => node.name === 'Resolver Cliente'));
  check(workflow.name + ': sin variables de entorno', !JSON.stringify(workflow).includes('$env'));
  check(workflow.name + ': sin Authorization manual', !JSON.stringify(workflow).includes('kommoToken'));

  const http = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
  check(
    workflow.name + ': todos los HTTP usan credencial de n8n con el tipo correcto',
    http.length > 0 && http.every((node) => {
      const tipo = node.parameters.genericAuthType;
      return node.parameters.authentication === 'genericCredentialType' && node.credentials && node.credentials[tipo];
    }),
    http.length + ' nodos HTTP'
  );
  check(
    workflow.name + ': cada HTTP lleva la credencial de su rama',
    http.every((node) => {
      const cliente = clientes.find((c) => node.name.startsWith(c.nombre + ' · '));
      if (!cliente) return false;
      const tipo = cliente.credencial.tipo;
      return node.credentials[tipo] && node.credentials[tipo].id === cliente.credencial.id;
    })
  );
  check(
    workflow.name + ': cada HTTP apunta al subdominio de su rama',
    http.every((node) => {
      const cliente = clientes.find((c) => node.name.startsWith(c.nombre + ' · '));
      return cliente && String(node.parameters.url || '').includes('https://' + cliente.subdominio + '.kommo.com');
    })
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
      .filter((node) => node.name.endsWith('Usuarios Kommo'))
      .every((node) => node.onError === 'continueRegularOutput' && node.alwaysOutputData === true && !('onError' in node.parameters))
  );
  check(
    workflow.name + ': los webhooks no quedan abiertos a cualquier origen',
    workflow.nodes.every((node) => node.type !== 'n8n-nodes-base.webhook' || !node.parameters.options || node.parameters.options.allowedOrigins === undefined)
  );
}

// =============================================================
// 3. Switch por cliente
// =============================================================

for (const workflow of [verificar, crear]) {
  const sw = workflow.nodes.find((node) => node.name === 'Switch Cliente');
  const reglas = sw.parameters.rules.values;
  check(workflow.name + ': el Switch tiene una regla por cliente', reglas.length === clientes.length, reglas.length + ' reglas');
  check(
    workflow.name + ': las reglas llevan el nombre de cada cliente',
    JSON.stringify(reglas.map((r) => r.outputKey)) === JSON.stringify(clientes.map((c) => c.nombre)),
    reglas.map((r) => r.outputKey).join(', ')
  );
  check(
    workflow.name + ': las reglas comparan contra el token de cada cliente',
    JSON.stringify(reglas.map((r) => r.conditions.conditions[0].rightValue)) === JSON.stringify(clientes.map((c) => c.tokenSwitch))
  );
  check(
    workflow.name + ': la comparación es por igualdad de texto sobre body.token',
    reglas.every((r) => {
      const cond = r.conditions.conditions[0];
      return cond.leftValue.includes('$json.body') && cond.leftValue.includes('String(') && cond.operator.type === 'string' && cond.operator.operation === 'equals';
    })
  );
  check(workflow.name + ': el caso sin coincidencia va a salida extra', sw.parameters.options.fallbackOutput === 'extra');
  check(
    workflow.name + ': el Switch tiene una salida por cliente más el fallback',
    workflow.connections['Switch Cliente'].main.length === clientes.length + 1,
    workflow.connections['Switch Cliente'].main.length + ' salidas'
  );
  check(
    workflow.name + ': cada salida entra por la rama de su cliente',
    workflow.connections['Switch Cliente'].main.every((rama, indice) => {
      if (indice === clientes.length) return rama[0].node === 'Acceso Denegado';
      return rama[0].node === n(clientes[indice], '¿Cuenta Correcta?');
    })
  );
}

// =============================================================
// 4. Referencias entre nodos: cada rama usa sus propios nodos
// =============================================================

for (const workflow of [verificar, crear]) {
  const referencias = [];
  for (const cliente of clientes) {
    for (const node of workflow.nodes.filter((nodo) => nodo.name.startsWith(cliente.nombre + ' · ') && nodo.type === 'n8n-nodes-base.code')) {
      for (const m of String(node.parameters.jsCode).matchAll(/\$\('([^']+)'\)/g)) {
        referencias.push({ desde: node.name, hacia: m[1] });
        const cruza = !m[1].startsWith(cliente.nombre + ' · ');
        if (cruza) referencias.push({ desde: node.name, hacia: m[1], cruza: true });
      }
    }
  }
  const cruzadas = referencias.filter((r) => r.cruza);
  check(workflow.name + ': ninguna rama referencia nodos de otra', cruzadas.length === 0, cruzadas.slice(0, 3).map((r) => r.desde + ' -> ' + r.hacia).join(' | '));
  check(workflow.name + ': las referencias apuntan a nodos existentes', referencias.every((r) => workflow.nodes.some((nodo) => nodo.name === r.hacia)), referencias.filter((r) => !workflow.nodes.some((nodo) => nodo.name === r.hacia)).slice(0, 3).map((r) => r.hacia).join(', '));
}

// =============================================================
// 5. Lógica de los nodos Code (rama de Altosa)
// =============================================================

const preparar = snippetOf(verificar, n(altosa, 'Preparar Consultas'));

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
check(
  'preparar: tolera que el payload venga sin envoltorio body',
  run(preparar, { json: { phone: '991234567', userId: 1 } })[0].json.phone === '+593991234567'
);

const unificar = snippetOf(verificar, n(altosa, 'Unificar Contactos'));
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
  nodes: { [n(altosa, 'Preparar Consultas')]: [{ json: { phone: '+593991234567', local: '991234567', userId: 77 } }] },
  input: [{ json: respuestaContactos }, { json: respuestaContactos }],
})[0].json;
check('unificar: deduplica por id', unificado.contactCount === 2, unificado.contactCount);
check('unificar: descarta teléfonos que no coinciden', !unificado.contactIds.includes(503));
check('unificar: junta los leads de todos los contactos', JSON.stringify(unificado.leadIds) === JSON.stringify([900, 901, 902]));
check('unificar: toma el nombre del primer contacto', unificado.contactName === 'María Zambrano');

const consolidar = snippetOf(verificar, n(altosa, 'Consolidar'));
const consolidado = run(consolidar, {
  json: {},
  nodes: {
    [n(altosa, 'Unificar Contactos')]: [{ json: unificado }],
    [n(altosa, 'Usuarios Kommo')]: [{ json: { _embedded: { users: [{ id: 77, name: 'Asesor UNYX' }, { id: 88, name: 'Otra Asesora' }] } } }],
  },
})[0].json;
check('consolidar: usa el subdominio del cliente de la rama', consolidado.subdomain === 'altosa', consolidado.subdomain);
check('consolidar: arma el mapa de usuarios', consolidado.userMap[88] === 'Otra Asesora');
check('consolidar: cada rama lleva sus pipelines excluidos', JSON.stringify(consolidado.pipelinesExcluidos) === JSON.stringify(altosa.pipelinesExcluidos));

const consolidarLux = snippetOf(verificar, n(luxviajes, 'Consolidar'));
const consolidadoLux = run(consolidarLux, {
  json: {},
  nodes: {
    [n(luxviajes, 'Unificar Contactos')]: [{ json: unificado }],
    [n(luxviajes, 'Usuarios Kommo')]: [{ json: { _embedded: { users: [] } } }],
  },
})[0].json;
check('consolidar: LuxViajes arrastra sus 4 pipelines excluidos', consolidadoLux.pipelinesExcluidos.length === 4, JSON.stringify(consolidadoLux.pipelinesExcluidos));
check('consolidar: el subdominio de LuxViajes es el suyo', consolidadoLux.subdomain === 'agencialuxviajes');

const evaluar = snippetOf(verificar, n(altosa, 'Evaluar Atención'));

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
    nodes: { [n(altosa, 'Consolidar')]: [{ json: base }], [n(altosa, 'Obtener Leads')]: [{ json: { _embedded: { leads } } }] },
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
check('evaluar: arma la URL con el subdominio de la rama', mio.activeLead.leadUrl === 'https://altosa.kommo.com/leads/12', mio.activeLead.leadUrl);
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

const evaluarCrear = snippetOf(crear, n(altosa, 'Evaluar Atención'));
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
  nodes: { [n(altosa, 'Consolidar')]: [{ json: crearData }], [n(altosa, 'Obtener Leads')]: [{ json: { _embedded: { leads: [] } } }] },
})[0].json;
check('crear: disponible reutiliza el contacto', disponible.state === 'available' && disponible.contactId === 501, JSON.stringify(disponible));
check('crear: arma el nombre del lead', disponible.leadName === 'María Zambrano · +593991234567', disponible.leadName);
const ocupado = run(evaluarCrear, {
  json: {},
  nodes: {
    [n(altosa, 'Consolidar')]: [{ json: crearData }],
    [n(altosa, 'Obtener Leads')]: [{ json: { _embedded: { leads: [{ id: 901, responsible_user_id: 88, created_at: 100, closed_at: null }] } } }],
  },
})[0].json;
check('crear: no disponible si hay atención activa', ocupado.state === 'other_agent', JSON.stringify(ocupado.state));
const sinContacto = run(evaluarCrear, {
  json: {},
  nodes: { [n(altosa, 'Consolidar')]: [{ json: Object.assign({}, crearData, { contactName: '', contacts: [], contactCount: 0, leadIds: [] }) }] },
})[0].json;
check('crear: sin contacto previo -> contactId null', sinContacto.contactId === null);
check('crear: sin nombre usa el teléfono', sinContacto.leadName === '+593991234567');

const cuerpoBloqueado = run(snippetOf(crear, n(altosa, 'Bloqueado')), { json: { state: 'other_agent', activeLead: { id: 1 }, leads: [] } })[0].json;
check('bloqueado: responde ok:false', cuerpoBloqueado.ok === false);
check('bloqueado: mensaje específico para otro asesor', /otro asesor/i.test(cuerpoBloqueado.message));

const cuerpoCreado = run(snippetOf(crear, n(altosa, 'Resultado')), {
  json: { _embedded: { leads: [{ id: 4321 }] } },
  nodes: { [n(altosa, 'Evaluar Atención')]: [{ json: { leadName: 'X · +593991234567', contactId: 501 } }] },
})[0].json;
check('resultado: devuelve el lead con la URL del cliente', cuerpoCreado.leadId === 4321 && cuerpoCreado.leadUrl === 'https://altosa.kommo.com/leads/4321', JSON.stringify(cuerpoCreado));

check('denegado: responde ok:false', run(snippetOf(verificar, 'Acceso Denegado'), { json: {} })[0].json.ok === false);
check('cuenta incorrecta: responde ok:false', run(snippetOf(verificar, n(altosa, 'Cuenta Incorrecta')), { json: {} })[0].json.ok === false);
check('inválido: responde ok:false', run(snippetOf(crear, n(meditec, 'Teléfono Inválido')), { json: {} })[0].json.ok === false);

// =============================================================
// 6. Coherencia widget <-> workflows
// =============================================================

check('el widget usa las rutas generales', widgetScript.includes("var CHECK_PATH = '/verificar-cliente'") && widgetScript.includes("var CREATE_PATH = '/crear-lead'"));
check('el widget lee n8n_base y unyx_token', widgetScript.includes('settings.n8n_base') && widgetScript.includes('settings.unyx_token'));
check('el widget envía el token', (widgetScript.match(/token: sharedToken/g) || []).length === 2);
check('el widget no trae URL por defecto', !/DEFAULT_N8N_URL\s*=\s*'https?:/.test(widgetScript));
check('el webhook es general para todos los clientes', verificar.nodes.find((x) => x.name === 'Webhook Widget').parameters.path === 'unyx/verificar-cliente');

// =============================================================
// Resumen
// =============================================================

const failed = results.filter((item) => !item.ok);
results.forEach((item) => {
  console.log((item.ok ? 'OK   ' : 'FAIL ') + item.label + (item.detail ? '  → ' + item.detail : ''));
});
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' comprobaciones OK');
process.exit(failed.length ? 1 : 0);
