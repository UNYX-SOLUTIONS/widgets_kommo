'use strict';

/**
 * Genera los DOS workflows generales de n8n (sirven para todos los clientes):
 *   unyx-verificar-cliente.json
 *   unyx-crear-lead.json
 *
 * El cliente se resuelve por token en el nodo "Resolver Cliente", a partir de
 * unyx/n8n/clientes.json. No hay un workflow por cliente.
 *
 * Uso: node unyx/n8n/build.js
 *
 * La cadena de nodos vive una sola vez en `cadenaComun()`: verificar y crear
 * comparten guarda de acceso, validación de teléfono, búsqueda de contactos,
 * lectura de leads y respondedor. No se pueden desincronizar.
 *
 * Autenticación de Kommo: no se usan credenciales de n8n. El token de larga
 * duración de cada cliente se lee de una variable de entorno
 * ($env.KOMMO_TOKEN_<CLIENTE>) y se envía en la cabecera Authorization. Los
 * tokens no están en este archivo ni en los JSON generados: solo sus nombres.
 */

const fs = require('fs');
const path = require('path');

const CODE_DIR = path.join(__dirname, 'code');

// Un único webhook base para todos los clientes: el cliente lo decide el token.
const BASE_WEBHOOK = 'unyx';
const RESOLVER = 'Resolver Cliente';
const HOST = "{{ $('" + RESOLVER + "').first().json.subdominio }}.kommo.com";
const AUTH = "=Bearer {{ $('" + RESOLVER + "').first().json.kommoToken }}";

function api(pathname) {
  return '=https://' + HOST + pathname;
}

function read(name) {
  return fs.readFileSync(path.join(CODE_DIR, name), 'utf8').trim();
}

function clientesLiteral(clientes) {
  const filas = clientes.map((cliente) =>
    '  { nombre: ' + JSON.stringify(cliente.nombre) +
    ', subdominio: ' + JSON.stringify(cliente.subdominio) +
    ', secreto: $env.' + cliente.secretoEnv +
    ', kommoToken: $env.' + cliente.kommoEnv +
    ', pipelinesExcluidos: ' + JSON.stringify(cliente.pipelinesExcluidos || []) +
    ' },'
  );
  return '[\n' + filas.join('\n') + '\n]';
}

function codeNode(name, id, position, jsCode) {
  return {
    parameters: { jsCode },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function ifNode(name, id, position, expression) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: id + '-cond',
            leftValue: '={{ ' + expression + ' }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
  };
}

function webhookNode(name, id, position, webhookPath, webhookId) {
  return {
    parameters: {
      httpMethod: 'POST',
      path: webhookPath,
      responseMode: 'responseNode',
      // Sin allowedOrigins: el widget llama por el proxy de Kommo (self.crm_post),
      // así que no se necesita CORS y no se expone el endpoint a páginas web.
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position,
    webhookId,
  };
}

function http(name, id, position, parameters, nodeProps) {
  return Object.assign(
    {
      parameters: Object.assign(
        {
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'Authorization', value: AUTH }] },
          options: { response: { response: { responseFormat: 'json' } } },
        },
        parameters
      ),
      id,
      name,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position,
    },
    nodeProps || {}
  );
}

function respondNode(name, id, position) {
  return {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ $json }}',
      options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } },
    },
    id,
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1,
    position,
  };
}

function note(content, position, height) {
  return {
    parameters: { content, height: height || 200 },
    type: 'n8n-nodes-base.stickyNote',
    position,
    typeVersion: 1,
    id: 'nota-' + position[0] + '-' + position[1],
    name: 'Nota ' + position[0] + ',' + position[1],
  };
}

const IF_PHONE = '/^(?:\\+?593)?0?9\\d{8}$/.test(String($json.phone || "").replace(/[\\s\\-()]/g, ""))';
const IF_HAS_LEADS = '$json.leadIds.length > 0';

// -------------------------------------------------------------
// Cadena común a los dos workflows
// -------------------------------------------------------------

function cadenaComun(clientes, codigo) {
  const nodos = [
    webhookNode(
      'Webhook Widget',
      'unyx-' + codigo + '-webhook',
      [0, 300],
      BASE_WEBHOOK + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead'),
      'b1a7c3d5-000' + (codigo === 'v' ? '1' : '2') + '-4a6b-8c9d-0e1f2a3b4c0' + (codigo === 'v' ? '1' : '2')
    ),
    codeNode(
      RESOLVER,
      'unyx-' + codigo + '-resolver',
      [220, 300],
      read('resolver-cliente.js').replace('__CLIENTES__', clientesLiteral(clientes))
    ),
    ifNode('¿Autorizado?', 'unyx-' + codigo + '-autorizado', [440, 300], '$json.autorizado === true'),
    ifNode('Teléfono Válido', 'unyx-' + codigo + '-telefono', [660, 300], IF_PHONE),
    codeNode('Teléfono Inválido', 'unyx-' + codigo + '-telefono-err', [880, 560], read('invalido.js')),
    codeNode('Preparar Consultas', 'unyx-' + codigo + '-preparar', [880, 180], read('preparar-consultas.js')),
    http('Buscar Contactos', 'unyx-' + codigo + '-contactos', [1100, 180], {
      method: 'GET',
      url: api('/api/v4/contacts'),
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'query', value: '={{ $json.variant }}' },
          { name: 'with', value: 'leads' },
          { name: 'limit', value: '250' },
        ],
      },
    }),
    codeNode('Unificar Contactos', 'unyx-' + codigo + '-unificar', [1320, 180], read('unificar-contactos.js')),
    http('Usuarios Kommo', 'unyx-' + codigo + '-usuarios', [1540, 180], {
      method: 'GET',
      url: api('/api/v4/users'),
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }, {
      // Un token sin permisos de administrador devuelve 403: sin esto la
      // ejecución se detiene y la degradación de "Consolidar" nunca corre.
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
    }),
    codeNode('Consolidar', 'unyx-' + codigo + '-consolidar', [1760, 180], read('consolidar.js')),
    ifNode('¿Tiene Leads?', 'unyx-' + codigo + '-tiene-leads', [1980, 180], IF_HAS_LEADS),
    http('Obtener Leads', 'unyx-' + codigo + '-leads', [2200, 80], {
      method: 'GET',
      url: api('/api/v4/leads?limit=250&{{ $json.leadIds.map((id) => "filter[id][]=" + id).join("&") }}'),
    }),
    respondNode('Responder al Widget', 'unyx-' + codigo + '-responder', [2600, 340]),
  ];

  const conexiones = {
    'Webhook Widget': { main: [[{ node: RESOLVER, type: 'main', index: 0 }]] },
    [RESOLVER]: { main: [[{ node: '¿Autorizado?', type: 'main', index: 0 }]] },
    '¿Autorizado?': {
      main: [
        [{ node: 'Teléfono Válido', type: 'main', index: 0 }],
        [{ node: 'Responder al Widget', type: 'main', index: 0 }],
      ],
    },
    'Teléfono Válido': {
      main: [
        [{ node: 'Preparar Consultas', type: 'main', index: 0 }],
        [{ node: 'Teléfono Inválido', type: 'main', index: 0 }],
      ],
    },
    'Teléfono Inválido': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Preparar Consultas': { main: [[{ node: 'Buscar Contactos', type: 'main', index: 0 }]] },
    'Buscar Contactos': { main: [[{ node: 'Unificar Contactos', type: 'main', index: 0 }]] },
    'Unificar Contactos': { main: [[{ node: 'Usuarios Kommo', type: 'main', index: 0 }]] },
    'Usuarios Kommo': { main: [[{ node: 'Consolidar', type: 'main', index: 0 }]] },
    'Consolidar': { main: [[{ node: '¿Tiene Leads?', type: 'main', index: 0 }]] },
    'Obtener Leads': { main: [[{ node: 'Evaluar Atención', type: 'main', index: 0 }]] },
    'Responder al Widget': { main: [[]] },
  };

  return { nodos, conexiones };
}

function notaComun(clientes, codigo) {
  const ruta = BASE_WEBHOOK + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead');
  const lineas = clientes.map((cliente) => '  - ' + cliente.nombre + ': `' + cliente.subdominio + '.kommo.com`');
  const content =
    '## UNYX · ' + (codigo === 'v' ? 'Verificar Cliente' : 'Crear Lead') + ' — general para todos los clientes\n' +
    'Webhook: `' + ruta + '`\n\n' +
    '**Cliente por token:** el nodo `' + RESOLVER + '` compara `body.token` con la variable de\n' +
    'entorno de cada cliente. Si no coincide, o la cuenta no es la suya, o falta su token de\n' +
    'Kommo, responde `ok:false` sin tocar la API.\n\n' +
    '**Tokens de Kommo:** se leen de variables de entorno y se envían en la cabecera\n' +
    '`Authorization`. Este workflow no usa credenciales de n8n.\n\n' +
    'Clientes configurados:\n' + lineas.join('\n') + '\n\n' +
    (codigo === 'v'
      ? '- **Atención activa = lead sin `closed_at`**, salvo pipelines excluidos.\n' +
        '- Busca el contacto por las 3 formas habituales del número y compara exacto.\n' +
        '- `filter[contacts][]` NO existe en la API v4: se usan los ids de `with=leads`.\n'
      : 'Re-valida justo antes de crear para evitar duplicados por concurrencia.\n' +
        '- Reutiliza el contacto existente; si no existe, lo crea con el campo PHONE.\n' +
        '- El lead se asigna al asesor del contexto (`userId` = `self.system().user_id`).\n' +
        '- Sin pipeline_id ni status_id: Kommo usa la primera etapa del pipeline principal.\n\n' +
        '**Concurrencia:** la revalidación reduce la ventana de carrera. Si tu versión de n8n\n' +
        'permite limitar la concurrencia del workflow a 1, actívalo para cerrarla del todo.\n') +
    'Generado por `unyx/n8n/build.js`: no editar este JSON a mano.';

  return note(content, [0, 40], codigo === 'v' ? 420 : 460);
}

function workflowVerificar(clientes) {
  const { nodos, conexiones } = cadenaComun(clientes, 'v');

  nodos.push(
    codeNode('Evaluar Atención', 'unyx-v-evaluar', [2420, 80], read('_comun.js') + '\n\n' + read('evaluar-verificar.js')),
    codeNode('Sin Leads Activos', 'unyx-v-sin-leads', [2420, 340], read('sin-leads-activos.js')),
    notaComun(clientes, 'v')
  );

  conexiones['¿Tiene Leads?'] = {
    main: [
      [{ node: 'Obtener Leads', type: 'main', index: 0 }],
      [{ node: 'Sin Leads Activos', type: 'main', index: 0 }],
    ],
  };
  conexiones['Evaluar Atención'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };
  conexiones['Sin Leads Activos'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };

  return {
    name: 'UNYX - Verificar Cliente (todos los clientes)',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxVerificarCl',
    tags: [],
  };
}

function workflowCrear(clientes) {
  const { nodos, conexiones } = cadenaComun(clientes, 'c');

  nodos.push(
    codeNode('Evaluar Atención', 'unyx-c-evaluar', [2420, 180], read('_comun.js') + '\n\n' + read('evaluar-crear.js')),
    ifNode('¿Disponible?', 'unyx-c-disponible', [2640, 180], '$json.state === "available"'),
    ifNode('¿Existe Contacto?', 'unyx-c-existe-contacto', [2860, 80], '$json.contactId !== null && $json.contactId !== undefined'),
    http('Campos Contacto', 'unyx-c-campos', [3080, 300], {
      method: 'GET',
      // Ruta documentada: /api/v4/{entidad}/custom_fields (no /contacts/fields).
      url: api('/api/v4/contacts/custom_fields'),
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }),
    http('Crear Contacto', 'unyx-c-crear-contacto', [3300, 300], {
      method: 'POST',
      url: api('/api/v4/contacts'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: ($(\'Evaluar Atención\').first().json.contactName || $(\'Evaluar Atención\').first().json.phone), responsible_user_id: $(\'Evaluar Atención\').first().json.userId, created_by: $(\'Evaluar Atención\').first().json.userId, custom_fields_values: [{ field_id: (($json._embedded && $json._embedded.custom_fields ? $json._embedded.custom_fields : []).find((f) => String(f.code || "").toUpperCase() === "PHONE") || {}).id, values: [{ value: $(\'Evaluar Atención\').first().json.phone, enum_code: "WORK" }] }] }]) }}',
    }),
    codeNode('Extraer Contacto', 'unyx-c-extraer', [3520, 300], read('extraer-contacto.js')),
    http('Crear Lead', 'unyx-c-crear-lead', [3740, 80], {
      method: 'POST',
      url: api('/api/v4/leads'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: $json.leadName, responsible_user_id: $json.userId, created_by: $json.userId, updated_by: $json.userId, _embedded: { contacts: [{ id: $json.contactId, is_main: true }] } }]) }}',
    }),
    codeNode('Resultado', 'unyx-c-resultado', [3960, 80], read('resultado.js')),
    codeNode('Bloqueado', 'unyx-c-bloqueado', [2860, 460], read('bloqueado.js')),
    notaComun(clientes, 'c')
  );

  conexiones['¿Tiene Leads?'] = {
    main: [
      [{ node: 'Obtener Leads', type: 'main', index: 0 }],
      [{ node: 'Evaluar Atención', type: 'main', index: 0 }],
    ],
  };
  conexiones['Evaluar Atención'] = { main: [[{ node: '¿Disponible?', type: 'main', index: 0 }]] };
  conexiones['¿Disponible?'] = {
    main: [
      [{ node: '¿Existe Contacto?', type: 'main', index: 0 }],
      [{ node: 'Bloqueado', type: 'main', index: 0 }],
    ],
  };
  conexiones['¿Existe Contacto?'] = {
    main: [
      [{ node: 'Crear Lead', type: 'main', index: 0 }],
      [{ node: 'Campos Contacto', type: 'main', index: 0 }],
    ],
  };
  conexiones['Campos Contacto'] = { main: [[{ node: 'Crear Contacto', type: 'main', index: 0 }]] };
  conexiones['Crear Contacto'] = { main: [[{ node: 'Extraer Contacto', type: 'main', index: 0 }]] };
  conexiones['Extraer Contacto'] = { main: [[{ node: 'Crear Lead', type: 'main', index: 0 }]] };
  conexiones['Crear Lead'] = { main: [[{ node: 'Resultado', type: 'main', index: 0 }]] };
  conexiones['Resultado'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };
  conexiones['Bloqueado'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };

  return {
    name: 'UNYX - Crear Lead (todos los clientes)',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxCrearLead',
    tags: [],
  };
}

function writeWorkflow(file, workflow) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(workflow, null, 2) + '\n', 'utf8');
  console.log('  ' + file + '  (' + workflow.nodes.length + ' nodos)');
}

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'clientes.json'), 'utf8'));
const clientes = config.clientes || [];

if (!clientes.length) {
  console.error('No hay clientes en clientes.json.');
  process.exit(1);
}

const invalidos = clientes.filter(
  (cliente) => !cliente.slug || !cliente.nombre || !cliente.subdominio || !cliente.secretoEnv || !cliente.kommoEnv
);
if (invalidos.length) {
  console.error('Clientes incompletos (faltan slug, nombre, subdominio, secretoEnv o kommoEnv):');
  invalidos.forEach((cliente) => console.error('  - ' + (cliente.nombre || cliente.slug || '(sin nombre)')));
  process.exit(1);
}

console.log('Clientes en el workflow general:');
clientes.forEach((cliente) => {
  console.log(
    '  ' + cliente.nombre.padEnd(12) + ' ' + (cliente.subdominio + '.kommo.com').padEnd(28) +
    '$env.' + cliente.secretoEnv.padEnd(24) + '$env.' + cliente.kommoEnv
  );
});
console.log('');
console.log('Webhook para todos los clientes: https://flow.unyxsolutions.com/webhook/' + BASE_WEBHOOK);
console.log('');
writeWorkflow('unyx-verificar-cliente.json', workflowVerificar(clientes));
writeWorkflow('unyx-crear-lead.json', workflowCrear(clientes));
