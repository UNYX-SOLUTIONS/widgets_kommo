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
 *
 * La cadena común de nodos se arma una sola vez en `cadenaComun()`: los dos
 * workflows comparten la guarda de acceso, la validación de teléfono, la
 * búsqueda de contactos, las etapas de lectura y el respondedor. Si se cambia
 * una validación, cambia en ambos por construcción.
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
    .replace(/__CLIENTE__/g, cliente.nombre)
    .replace(/__PIPELINES_EXCLUIDOS__/g, JSON.stringify(cliente.pipelinesExcluidos || []));
}

function credencialTipo(cliente) {
  return cliente.credencial.tipo === 'httpBearerAuth' ? 'httpBearerAuth' : 'httpHeaderAuth';
}

function credentials(cliente) {
  const tipo = credencialTipo(cliente);
  const valor = {};
  valor[tipo] = { id: cliente.credencial.id, name: cliente.credencial.name };
  return valor;
}

function httpRequest(cliente, name, id, position, parameters, nodeProps) {
  return Object.assign(
    {
      parameters: Object.assign(
        {
          authentication: 'genericCredentialType',
          genericAuthType: credencialTipo(cliente),
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
    },
    // onError y alwaysOutputData son propiedades del NODO, no de parameters.
    nodeProps || {}
  );
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

// -------------------------------------------------------------
// Guardas
// -------------------------------------------------------------

// El token compartido se compara contra una variable de entorno de n8n.
// Si la variable está vacía, la expresión es falsa y se deniega todo.
// Se fuerza a booleano: con typeValidation estricto, un `undefined` por
// variable ausente haría fallar la condición en vez de denegar limpiamente.
function accesoExpr(cliente) {
  const var_ = cliente.secretoEnv;
  return (
    'Boolean($env.' + var_ + ') && String($json.body && $json.body.token || "") === String($env.' + var_ + ')'
  );
}

const IF_PHONE = '/^(?:\\+?593)?0?9\\d{8}$/.test(String($json.body && $json.body.phone || "").replace(/[\\s\\-()]/g, ""))';
const IF_HAS_LEADS = '$json.leadIds.length > 0';

function ifAccount(cliente) {
  return 'String($json.body && $json.body.account || "").trim().toLowerCase() === "' + cliente.subdominio.toLowerCase() + '"';
}

// -------------------------------------------------------------
// Cadena común a los dos workflows
// -------------------------------------------------------------

const NODOS_RESPUESTA = ['Acceso Denegado', 'Cuenta No Autorizada', 'Teléfono Inválido'];

function cadenaComun(cliente, codigo) {
  const nodos = [
    webhookNode(
      'Webhook Widget',
      'unyx-' + codigo + '-webhook',
      [0, 300],
      'unyx-' + cliente.slug + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead'),
      'b1a7c3d5-000' + (codigo === 'v' ? '1' : '2') + '-4a6b-8c9d-0e1f2a3b4c0' + (codigo === 'v' ? '1' : '2')
    ),
    ifNode('Acceso Autorizado', 'unyx-' + codigo + '-acceso', [220, 300], accesoExpr(cliente)),
    codeNode('Acceso Denegado', 'unyx-' + codigo + '-denegado', [440, 560], read('acceso-denegado.js')),
    ifNode('Cuenta Correcta', 'unyx-' + codigo + '-cuenta', [440, 300], ifAccount(cliente)),
    codeNode('Cuenta No Autorizada', 'unyx-' + codigo + '-cuenta-err', [660, 560], read('cuenta-no-autorizada.js')),
    ifNode('Teléfono Válido', 'unyx-' + codigo + '-telefono', [660, 300], IF_PHONE),
    codeNode('Teléfono Inválido', 'unyx-' + codigo + '-telefono-err', [880, 560], read('invalido.js')),
    codeNode('Preparar Consultas', 'unyx-' + codigo + '-preparar', [880, 180], code(cliente, 'preparar-consultas.js')),
    httpRequest(cliente, 'Buscar Contactos', 'unyx-' + codigo + '-contactos', [1100, 180], {
      method: 'GET',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'query', value: '={{ $json.variant }}' },
          { name: 'with', value: 'leads' },
          { name: 'limit', value: '250' },
        ],
      },
    }),
    codeNode('Unificar Contactos', 'unyx-' + codigo + '-unificar', [1320, 180], code(cliente, 'unificar-contactos.js')),
    httpRequest(cliente, 'Usuarios Kommo', 'unyx-' + codigo + '-usuarios', [1540, 180], {
      method: 'GET',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/users',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }, {
      // Un token sin permisos de administrador devuelve 403: sin esto la
      // ejecución se detiene y la degradación de "Consolidar" nunca corre.
      onError: 'continueRegularOutput',
      alwaysOutputData: true,
    }),
    codeNode('Consolidar', 'unyx-' + codigo + '-consolidar', [1760, 180], code(cliente, 'consolidar.js')),
    ifNode('¿Tiene Leads?', 'unyx-' + codigo + '-tiene-leads', [1980, 180], IF_HAS_LEADS),
    httpRequest(cliente, 'Obtener Leads', 'unyx-' + codigo + '-leads', [2200, 80], {
      method: 'GET',
      url:
        '=' +
        KOMMO_HOST(cliente.subdominio) +
        '/api/v4/leads?limit=250&{{ $json.leadIds.map((id) => "filter[id][]=" + id).join("&") }}',
    }),
    respondNode('Responder al Widget', 'unyx-' + codigo + '-responder', [2600, 340]),
  ];

  const conexiones = {
    'Webhook Widget': { main: [[{ node: 'Acceso Autorizado', type: 'main', index: 0 }]] },
    'Acceso Autorizado': {
      main: [
        [{ node: 'Cuenta Correcta', type: 'main', index: 0 }],
        [{ node: 'Acceso Denegado', type: 'main', index: 0 }],
      ],
    },
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
    'Obtener Leads': { main: [[{ node: 'Evaluar Atención', type: 'main', index: 0 }]] },
    'Responder al Widget': { main: [[]] },
  };

  return { nodos, conexiones };
}

function conectarRespuestas(conexiones, nombres) {
  for (const nombre of nombres) {
    if (!conexiones[nombre]) conexiones[nombre] = { main: [[]] };
    conexiones[nombre] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };
  }
  return conexiones;
}

function notaComun(cliente, codigo) {
  const ruta = 'unyx-' + cliente.slug + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead');
  const content =
    '## UNYX · ' + (codigo === 'v' ? 'Verificar Cliente' : 'Crear Lead') + ' — ' + cliente.nombre + '\n' +
    'Cuenta: `' + cliente.subdominio + '.kommo.com` · Webhook: `' + ruta + '`\n\n' +
    '**Acceso:** el primer nodo exige `token` = variable de entorno `' + cliente.secretoEnv + '`.\n' +
    'Si esa variable no está definida en n8n, el workflow deniega todo (fail-closed).\n\n' +
    (codigo === 'v'
      ? '- Busca el contacto por las 3 formas habituales del número y compara exacto.\n' +
        '- **Atención activa = lead sin `closed_at`**, salvo pipelines excluidos.\n' +
        '- `filter[contacts][]` NO existe en la API v4: se usan los ids de `with=leads`.\n'
      : 'Re-valida justo antes de crear para evitar duplicados por concurrencia.\n' +
        '- Reutiliza el contacto existente; si no existe, lo crea con el campo PHONE.\n' +
        '- El lead se asigna al asesor del contexto (`userId` = `self.system().user_id`).\n' +
        '- Sin pipeline_id ni status_id: Kommo usa la primera etapa del pipeline principal.\n\n' +
        '**Concurrencia:** la revalidación reduce la ventana de carrera. Si tu versión de n8n\n' +
        'permite limitar la concurrencia del workflow a 1, actívalo para cerrarla del todo.\n') +
    'Generado por `unyx/n8n/build.js`: no editar este JSON a mano.';

  return note(content, [0, 40], codigo === 'v' ? 340 : 380);
}

// -------------------------------------------------------------
// Workflow: verificar
// -------------------------------------------------------------

function workflowVerificar(cliente) {
  const { nodos, conexiones } = cadenaComun(cliente, 'v');

  nodos.push(
    codeNode('Evaluar Atención', 'unyx-v-evaluar', [2420, 80], code(cliente, '_comun.js', 'evaluar-verificar.js')),
    codeNode('Sin Leads Activos', 'unyx-v-sin-leads', [2420, 340], code(cliente, 'sin-leads-activos.js')),
    notaComun(cliente, 'v')
  );

  conexiones['¿Tiene Leads?'] = {
    main: [
      [{ node: 'Obtener Leads', type: 'main', index: 0 }],
      [{ node: 'Sin Leads Activos', type: 'main', index: 0 }],
    ],
  };
  conexiones['Evaluar Atención'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };
  conexiones['Sin Leads Activos'] = { main: [[{ node: 'Responder al Widget', type: 'main', index: 0 }]] };
  conectarRespuestas(conexiones, NODOS_RESPUESTA);

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Verificar Cliente',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxVerif' + cliente.slug.slice(0, 7),
    tags: [],
  };
}

// -------------------------------------------------------------
// Workflow: crear lead
// -------------------------------------------------------------

function workflowCrear(cliente) {
  const { nodos, conexiones } = cadenaComun(cliente, 'c');

  nodos.push(
    codeNode('Evaluar Atención', 'unyx-c-evaluar', [2420, 180], code(cliente, '_comun.js', 'evaluar-crear.js')),
    ifNode('¿Disponible?', 'unyx-c-disponible', [2640, 180], '$json.state === "available"'),
    ifNode('¿Existe Contacto?', 'unyx-c-existe-contacto', [2860, 80], '$json.contactId !== null && $json.contactId !== undefined'),
    httpRequest(cliente, 'Campos Contacto', 'unyx-c-campos', [3080, 300], {
      method: 'GET',
      // Ruta documentada: /api/v4/{entidad}/custom_fields (no /contacts/fields).
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts/custom_fields',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }),
    httpRequest(cliente, 'Crear Contacto', 'unyx-c-crear-contacto', [3300, 300], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: ($(\'Evaluar Atención\').first().json.contactName || $(\'Evaluar Atención\').first().json.phone), responsible_user_id: $(\'Evaluar Atención\').first().json.userId, created_by: $(\'Evaluar Atención\').first().json.userId, custom_fields_values: [{ field_id: (($json._embedded && $json._embedded.custom_fields ? $json._embedded.custom_fields : []).find((f) => String(f.code || "").toUpperCase() === "PHONE") || {}).id, values: [{ value: $(\'Evaluar Atención\').first().json.phone, enum_code: "WORK" }] }] }]) }}',
    }),
    codeNode('Extraer Contacto', 'unyx-c-extraer', [3520, 300], code(cliente, 'extraer-contacto.js')),
    httpRequest(cliente, 'Crear Lead', 'unyx-c-crear-lead', [3740, 80], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/leads',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: $json.leadName, responsible_user_id: $json.userId, created_by: $json.userId, updated_by: $json.userId, _embedded: { contacts: [{ id: $json.contactId, is_main: true }] } }]) }}',
    }),
    codeNode('Resultado', 'unyx-c-resultado', [3960, 80], code(cliente, 'resultado.js')),
    codeNode('Bloqueado', 'unyx-c-bloqueado', [2860, 460], code(cliente, 'bloqueado.js')),
    notaComun(cliente, 'c')
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
  conectarRespuestas(conexiones, NODOS_RESPUESTA);

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Crear Lead',
    nodes: nodos,
    connections: conexiones,
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
  const faltan = ['slug', 'nombre', 'subdominio', 'secretoEnv'].filter((campo) => !cliente[campo]);
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

  console.log('Cliente ' + cliente.nombre + ' (' + cliente.subdominio + ')');
  console.log('  widget n8n_base = https://flow.unyxsolutions.com/webhook/unyx-' + cliente.slug);
  console.log('  secreto en n8n = $env.' + cliente.secretoEnv);
  writeWorkflow('unyx-' + cliente.slug + '-verificar-cliente.json', workflowVerificar(cliente));
  writeWorkflow('unyx-' + cliente.slug + '-crear-lead.json', workflowCrear(cliente));
}
