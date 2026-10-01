'use strict';

/**
 * Genera los workflow JSON de n8n a partir de:
 *   - clientes.json  (una entrada por cuenta de Kommo)
 *   - code/*.js      (lógica de los nodos Code, sin duplicar reglas)
 *
 * Por cada cliente activo salen dos archivos:
 *   unyx-<slug>-verificar-cliente.json
 *   unyx-<slug>-crear-lead.json
 *
 * Uso: node unyx/n8n/build.js [slug]
 *      (sin argumento, genera todos los clientes)
 */

const fs = require('fs');
const path = require('path');

const CODE_DIR = path.join(__dirname, 'code');
const KOMMO_HOST = (subdominio) => 'https://' + subdominio + '.kommo.com';

function read(name) {
  return fs.readFileSync(path.join(CODE_DIR, name), 'utf8').trim();
}

function code(cliente, ...files) {
  return files
    .map(read)
    .join('\n\n')
    .replace(/__SUBDOMINIO__/g, cliente.subdominio)
    .replace(/__CLIENTE__/g, cliente.nombre);
}

function credentials(cliente) {
  return {
    httpHeaderAuth: {
      id: cliente.credencial.id,
      name: cliente.credencial.name,
    },
  };
}

function httpRequest(cliente, name, id, position, parameters) {
  return {
    parameters: Object.assign(
      {
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        options: { response: { response: { responseFormat: 'json' } } },
      },
      parameters
    ),
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    credentials: credentials(cliente),
  };
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
      options: { allowedOrigins: '*' },
    },
    id,
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position,
    webhookId,
  };
}

function respondNode(name, id, position) {
  return {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ $json }}',
      options: {
        responseHeaders: {
          entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }],
        },
      },
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
    id: 'note-' + position[0] + '-' + position[1],
    name: 'Nota ' + position[0] + ',' + position[1],
  };
}

const IF_PHONE = '/^(?:\\+?593)?0?9\\d{8}$/.test(String($json.body && $json.body.phone || "").replace(/[\\s\\-()]/g, ""))';
const IF_HAS_LEADS = '$json.leadIds.length > 0';
const IF_AVAILABLE = '$json.state === "available"';
const IF_HAS_CONTACT = '$json.contactId !== null && $json.contactId !== undefined';
const ifAccount = (cliente) =>
  'String($json.body && $json.body.account || "").trim().toLowerCase() === "' + cliente.subdominio.toLowerCase() + '"';

function contactQuery() {
  return {
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'query', value: '={{ $json.variant }}' },
        { name: 'with', value: 'leads' },
        { name: 'limit', value: '25' },
      ],
    },
  };
}

function leadsUrl(cliente) {
  return (
    '=' +
    KOMMO_HOST(cliente.subdominio) +
    '/api/v4/leads?limit=250&{{ $json.leadIds.map((id) => "filter[id][]=" + id).join("&") }}'
  );
}

function workflowVerificar(cliente) {
  const prefix = 'unyx-' + cliente.slug;
  const nodes = [
    webhookNode('Webhook Widget', 'whv-0000-0000-0000-000000000001', [0, 300], prefix + '/verificar-cliente', 'b1a7c3d5-0001-4a6b-8c9d-0e1f2a3b4c01'),
    ifNode('Cuenta Correcta', 'ifv-0000-0000-0000-000000000000', [220, 300], ifAccount(cliente)),
    codeNode('Cuenta No Autorizada', 'cdv-0000-0000-0000-000000000007', [440, 520], read('cuenta-no-autorizada.js')),
    ifNode('Teléfono Válido', 'ifv-0000-0000-0000-000000000001', [440, 300], IF_PHONE),
    codeNode('Preparar Consultas', 'cdv-0000-0000-0000-000000000001', [660, 180], code(cliente, 'preparar-consultas.js')),
    httpRequest(cliente, 'Buscar Contactos', 'htv-0000-0000-0000-000000000001', [880, 180], Object.assign({ method: 'GET', url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts' }, contactQuery())),
    codeNode('Unificar Contactos', 'cdv-0000-0000-0000-000000000002', [1100, 180], code(cliente, 'unificar-contactos.js')),
    httpRequest(cliente, 'Usuarios Kommo', 'htv-0000-0000-0000-000000000004', [1320, 180], {
      method: 'GET',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/users',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }),
    codeNode('Consolidar', 'cdv-0000-0000-0000-000000000003', [1540, 180], code(cliente, 'consolidar.js')),
    ifNode('¿Tiene Leads?', 'ifv-0000-0000-0000-000000000002', [1760, 180], IF_HAS_LEADS),
    httpRequest(cliente, 'Obtener Leads', 'htv-0000-0000-0000-000000000005', [1980, 80], {
      method: 'GET',
      url: leadsUrl(cliente),
    }),
    codeNode('Evaluar Atención', 'cdv-0000-0000-0000-000000000004', [2200, 80], code(cliente, '_comun.js', 'evaluar-verificar.js')),
    codeNode('Sin Leads Activos', 'cdv-0000-0000-0000-000000000005', [1980, 340], code(cliente, 'sin-leads-activos.js')),
    codeNode('Teléfono Inválido', 'cdv-0000-0000-0000-000000000006', [660, 420], code(cliente, 'invalido.js')),
    respondNode('Responder al Widget', 'rsv-0000-0000-0000-000000000001', [2440, 300]),
    note(
      '## UNYX · Verificar Cliente — ' + cliente.nombre + '\n' +
        'Cuenta: `' + cliente.subdominio + '.kommo.com` · Webhook: `' + prefix + '/verificar-cliente`\n\n' +
        'El asesor ingresa un celular y se comprueba si el contacto ya tiene una atención activa.\n\n' +
        '- Busca el contacto por las 3 formas habituales del número y compara exacto.\n' +
        '- **Atención activa = lead sin `closed_at`.** No se consultan pipelines ni etapas:\n' +
        '  la regla es la misma en cualquier cuenta y no hay que configurar nada por cliente.\n' +
        '- `filter[contacts][]` NO existe en la API v4: se usan los ids que devuelve `with=leads`.\n' +
        '- El primer nodo rechaza el request si viene de otra cuenta de Kommo.\n\n' +
        'Responde **siempre 200** con `ok:true/false`; el widget decide qué mostrar.\n' +
        'Generado por `unyx/n8n/build.js`: no editar este JSON a mano.',
      [0, 40],
      340
    ),
  ];

  const connections = {
    'Webhook Widget': { main: [[{ node: 'Cuenta Correcta', type: 'main', index: 0 }]] },
    'Cuenta Correcta': {
      main: [
        [{ node: 'Teléfono Válido', type: 'main', index: 0 }],
        [{ node: 'Cuenta No Autorizada', type: 'main', index: 0 }],
      ],
    },
    'Teléfono Válido': {
      main: [
        [{ node: 'Preparar Consultas', type: 'main', index: 0 }],
        [{ node: 'Teléfono Inválido', type: 'main', index: 0 }],
      ],
    },
    'Preparar Consultas': { main: [[{ node: 'Buscar Contactos', type: 'main', index: 0 }]] },
    'Buscar Contactos': { main: [[{ node: 'Unificar Contactos', type: 'main', index: 0 }]] },
    'Unificar Contactos': { main: [[{ node: 'Usuarios Kommo', type: 'main', index: 0 }]] },
    'Usuarios Kommo': { main: [[{ node: 'Consolidar', type: 'main', index: 0 }]] },
    'Consolidar': { main: [[{ node: '¿Tiene Leads?', type: 'main', index: 0 }]] },
    '¿Tiene Leads?': {
      main: [
        [{ node: 'Obtener Leads', type: 'main', index: 0 }],
        [{ node: 'Sin Leads Activos', type: 'main', index: 0 }],
      ],
    },
    'Obtener Leads': { main: [[{ node: 'Evaluar Atención', type: 'main', index: 0 }]] },
    'Evaluar Atención': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Sin Leads Activos': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Teléfono Inválido': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Cuenta No Autorizada': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
  };

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Verificar Cliente',
    nodes,
    connections,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxVerif' + cliente.slug.slice(0, 7),
    tags: [],
  };
}

function workflowCrear(cliente) {
  const prefix = 'unyx-' + cliente.slug;
  const nodes = [
    webhookNode('Webhook Widget', 'whc-0000-0000-0000-000000000001', [0, 300], prefix + '/crear-lead', 'b1a7c3d5-0002-4a6b-8c9d-0e1f2a3b4c02'),
    ifNode('Cuenta Correcta', 'ifc-0000-0000-0000-000000000000', [220, 300], ifAccount(cliente)),
    codeNode('Cuenta No Autorizada', 'cdc-0000-0000-0000-000000000009', [440, 520], read('cuenta-no-autorizada.js')),
    ifNode('Teléfono Válido', 'ifc-0000-0000-0000-000000000001', [440, 300], IF_PHONE),
    codeNode('Preparar Consultas', 'cdc-0000-0000-0000-000000000001', [660, 180], code(cliente, 'preparar-consultas.js')),
    httpRequest(cliente, 'Buscar Contactos', 'htc-0000-0000-0000-000000000001', [880, 180], Object.assign({ method: 'GET', url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts' }, contactQuery())),
    codeNode('Unificar Contactos', 'cdc-0000-0000-0000-000000000002', [1100, 180], code(cliente, 'unificar-contactos.js')),
    httpRequest(cliente, 'Usuarios Kommo', 'htc-0000-0000-0000-000000000004', [1320, 180], {
      method: 'GET',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/users',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }),
    codeNode('Consolidar', 'cdc-0000-0000-0000-000000000003', [1540, 180], code(cliente, 'consolidar.js')),
    ifNode('¿Tiene Leads?', 'ifc-0000-0000-0000-000000000002', [1760, 180], IF_HAS_LEADS),
    httpRequest(cliente, 'Obtener Leads', 'htc-0000-0000-0000-000000000005', [1980, 80], {
      method: 'GET',
      url: leadsUrl(cliente),
    }),
    codeNode('Evaluar Atención', 'cdc-0000-0000-0000-000000000004', [2200, 180], code(cliente, '_comun.js', 'evaluar-crear.js')),
    ifNode('¿Disponible?', 'ifc-0000-0000-0000-000000000003', [2420, 180], IF_AVAILABLE),
    ifNode('¿Existe Contacto?', 'ifc-0000-0000-0000-000000000004', [2640, 80], IF_HAS_CONTACT),
    httpRequest(cliente, 'Campos Contacto', 'htc-0000-0000-0000-000000000006', [2860, 300], {
      method: 'GET',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts/fields',
    }),
    httpRequest(cliente, 'Crear Contacto', 'htc-0000-0000-0000-000000000007', [3080, 300], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: ($(\'Evaluar Atención\').first().json.contactName || $(\'Evaluar Atención\').first().json.phone), responsible_user_id: $(\'Evaluar Atención\').first().json.userId, created_by: $(\'Evaluar Atención\').first().json.userId, custom_fields_values: [{ field_id: (($json._embedded.custom_fields.find((f) => f.field_code === "PHONE") || {}).id || null), values: [{ value: $(\'Evaluar Atención\').first().json.phone, enum_code: "WORK" }] }] }]) }}',
    }),
    codeNode('Extraer Contacto', 'cdc-0000-0000-0000-000000000005', [3300, 300], code(cliente, 'extraer-contacto.js')),
    httpRequest(cliente, 'Crear Lead', 'htc-0000-0000-0000-000000000008', [3520, 80], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/leads',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: $json.leadName, responsible_user_id: $json.userId, created_by: $json.userId, updated_by: $json.userId, _embedded: { contacts: [{ id: $json.contactId, is_main: true }] } }]) }}',
    }),
    codeNode('Resultado', 'cdc-0000-0000-0000-000000000006', [3740, 80], code(cliente, 'resultado.js')),
    codeNode('Bloqueado', 'cdc-0000-0000-0000-000000000007', [2640, 460], code(cliente, 'bloqueado.js')),
    codeNode('Teléfono Inválido', 'cdc-0000-0000-0000-000000000008', [660, 460], code(cliente, 'invalido.js')),
    respondNode('Responder al Widget', 'rsc-0000-0000-0000-000000000001', [3960, 300]),
    note(
      '## UNYX · Crear Lead — ' + cliente.nombre + '\n' +
        'Cuenta: `' + cliente.subdominio + '.kommo.com` · Webhook: `' + prefix + '/crear-lead`\n\n' +
        'Re-valida justo antes de crear para evitar duplicados por concurrencia.\n\n' +
        '- Mismas reglas que «Verificar Cliente» (snippet compartido `_comun.js`).\n' +
        '- Reutiliza el contacto existente; si no existe, lo crea con el campo PHONE.\n' +
        '- El lead se asigna al asesor del contexto (`userId` = `self.system().user_id`).\n' +
        '- Sin pipeline_id ni status_id: Kommo usa la primera etapa del pipeline principal.\n' +
        '- El primer nodo rechaza el request si viene de otra cuenta de Kommo.\n\n' +
        '**Concurrencia:** la revalidación reduce la ventana de carrera. Si tu versión de n8n\n' +
        'permite limitar la concurrencia del workflow a 1, actívalo para cerrarla del todo.\n' +
        'Generado por `unyx/n8n/build.js`: no editar este JSON a mano.',
      [0, 40],
      360
    ),
  ];

  const connections = {
    'Webhook Widget': { main: [[{ node: 'Cuenta Correcta', type: 'main', index: 0 }]] },
    'Cuenta Correcta': {
      main: [
        [{ node: 'Teléfono Válido', type: 'main', index: 0 }],
        [{ node: 'Cuenta No Autorizada', type: 'main', index: 0 }],
      ],
    },
    'Teléfono Válido': {
      main: [
        [{ node: 'Preparar Consultas', type: 'main', index: 0 }],
        [{ node: 'Teléfono Inválido', type: 'main', index: 0 }],
      ],
    },
    'Preparar Consultas': { main: [[{ node: 'Buscar Contactos', type: 'main', index: 0 }]] },
    'Buscar Contactos': { main: [[{ node: 'Unificar Contactos', type: 'main', index: 0 }]] },
    'Unificar Contactos': { main: [[{ node: 'Usuarios Kommo', type: 'main', index: 0 }]] },
    'Usuarios Kommo': { main: [[{ node: 'Consolidar', type: 'main', index: 0 }]] },
    'Consolidar': { main: [[{ node: '¿Tiene Leads?', type: 'main', index: 0 }]] },
    '¿Tiene Leads?': {
      main: [
        [{ node: 'Obtener Leads', type: 'main', index: 0 }],
        [{ node: 'Evaluar Atención', type: 'main', index: 0 }],
      ],
    },
    'Obtener Leads': { main: [[{ node: 'Evaluar Atención', type: 'main', index: 0 }]] },
    'Evaluar Atención': { main: [[{ node: '¿Disponible?', type: 'main', index: 0 }]] },
    '¿Disponible?': {
      main: [
        [{ node: '¿Existe Contacto?', type: 'main', index: 0 }],
        [{ node: 'Bloqueado', type: 'main', index: 0 }],
      ],
    },
    '¿Existe Contacto?': {
      main: [
        [{ node: 'Crear Lead', type: 'main', index: 0 }],
        [{ node: 'Campos Contacto', type: 'main', index: 0 }],
      ],
    },
    'Campos Contacto': { main: [[{ node: 'Crear Contacto', type: 'main', index: 0 }]] },
    'Crear Contacto': { main: [[{ node: 'Extraer Contacto', type: 'main', index: 0 }]] },
    'Extraer Contacto': { main: [[{ node: 'Crear Lead', type: 'main', index: 0 }]] },
    'Crear Lead': { main: [[{ node: 'Resultado', type: 'main', index: 0 }]] },
    'Resultado': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Bloqueado': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Teléfono Inválido': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
    'Cuenta No Autorizada': { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] },
  };

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Crear Lead',
    nodes,
    connections,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxCrear' + cliente.slug.slice(0, 7),
    tags: [],
  };
}

function writeWorkflow(file, workflow) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(workflow, null, 2) + '\n', 'utf8');
  console.log('  ' + file + '  (' + workflow.nodes.length + ' nodos)');
}

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'clientes.json'), 'utf8'));
const only = process.argv[2];
const clientes = (config.clientes || []).filter((cliente) => !only || cliente.slug === only);

if (!clientes.length) {
  console.error('No hay clientes que generar' + (only ? ' para el slug "' + only + '"' : '') + '.');
  process.exit(1);
}

for (const cliente of clientes) {
  const faltan = ['slug', 'nombre', 'subdominio'].filter((campo) => !cliente[campo]);
  if (faltan.length) {
    console.warn('AVISO: se salta un cliente sin ' + faltan.join(', ') + '.');
    continue;
  }
  if (!cliente.credencial || !cliente.credencial.id) {
    console.warn(
      'AVISO: se salta ' + cliente.nombre + ' (falta el id de la credencial en n8n). ' +
        'Complete clientes.json y vuelva a ejecutar.'
    );
    continue;
  }

  const prefijo = 'https://flow.unyxsolutions.com/webhook/unyx-' + cliente.slug;
  console.log('Cliente ' + cliente.nombre + ' (' + cliente.subdominio + ')');
  console.log('  widget n8n_url = ' + prefijo);
  writeWorkflow('unyx-' + cliente.slug + '-verificar-cliente.json', workflowVerificar(cliente));
  writeWorkflow('unyx-' + cliente.slug + '-crear-lead.json', workflowCrear(cliente));
}
