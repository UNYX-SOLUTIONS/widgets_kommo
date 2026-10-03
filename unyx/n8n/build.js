'use strict';

/**
 * Genera un PAR de workflows por cada cliente de clientes.json:
 *   <slug>-verificar-cliente.json
 *   <slug>-crear-lead.json
 *
 * Hoy sólo está la configuración madre (unyx). Para un cliente se duplica el
 * workflow completo: se agrega su entrada a clientes.json y se vuelve a
 * ejecutar; no hay Switch ni ramas dentro de un mismo workflow.
 *
 * Uso: node unyx/n8n/build.js [slug]
 *
 * Cada workflow tiene sus propios nodos con el subdominio y la credencial de
 * n8n de ese cliente. No se usan variables de entorno.
 */

const fs = require('fs');
const path = require('path');

const CODE_DIR = path.join(__dirname, 'code');

const RESPONDER = 'Responder al Widget';
const KOMMO_HOST = (subdominio) => 'https://' + subdominio + '.kommo.com';

// Nombres de nodo dentro de un workflow (sin prefijo: cada workflow es de un
// solo cliente). Los snippets los usan como __N_<CLAVE>__.
const NOMBRES = {
  PREPARAR: 'Preparar Consultas',
  UNIFICAR: 'Unificar Contactos',
  USUARIOS: 'Usuarios Kommo',
  CONSOLIDAR: 'Consolidar',
  LEADS: 'Obtener Leads',
  EVALUAR: 'Evaluar Atención',
};

const CREDENCIAL_TIPOS = { httpHeaderAuth: true, httpBearerAuth: true };

function read(name) {
  return fs.readFileSync(path.join(CODE_DIR, name), 'utf8').trim();
}

function credencialTipo(cliente) {
  const tipo = cliente.credencial && cliente.credencial.tipo;
  return CREDENCIAL_TIPOS[tipo] ? tipo : 'httpHeaderAuth';
}

/** Adapta un snippet al cliente: nombres de nodo, subdominio y exclusiones. */
function scoped(snippet, cliente) {
  return snippet
    .replace(/\$\('__N_([A-Z_]+)__'\)/g, (match, clave) => {
      if (!NOMBRES[clave]) throw new Error('Placeholder de nodo desconocido: ' + clave);
      return "$('" + NOMBRES[clave] + "')";
    })
    .replace(/__SUBDOMINIO__/g, cliente.subdominio)
    .replace(/__PIPELINES_EXCLUIDOS__/g, JSON.stringify(cliente.pipelinesExcluidos || []))
    .replace(/__CLIENTE__/g, cliente.nombre);
}

function codeNode(name, id, position, jsCode) {
  return { parameters: { jsCode }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position };
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

function httpNode(cliente, name, id, position, parameters, nodeProps) {
  const tipo = credencialTipo(cliente);
  const credentials = {};
  credentials[tipo] = { id: cliente.credencial.id, name: cliente.credencial.name };

  return Object.assign(
    {
      parameters: Object.assign(
        {
          authentication: 'genericCredentialType',
          genericAuthType: tipo,
          options: { response: { response: { responseFormat: 'json' } } },
        },
        parameters
      ),
      id,
      name,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position,
      credentials,
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

// El token del widget se compara contra el valor que se pega en n8n, y la
// cuenta contra el subdominio de esta configuración. Un body sin token no
// rompe la condición: String() garantiza texto.
function ifAutorizado(cliente) {
  return (
    'String($json.body && $json.body.token || "") === "' + cliente.tokenWidget + '"' +
    ' && String($json.body && $json.body.account || "").trim().toLowerCase() === "' + cliente.subdominio.toLowerCase() + '"'
  );
}

const IF_PHONE = '/^(?:\\+?593)?0?9\\d{8}$/.test(String($json.body && $json.body.phone || "").replace(/[\\s\\-()]/g, ""))';
const IF_HAS_LEADS = '$json.leadIds.length > 0';

/**
 * Cadena común a los dos workflows. Los nodos se colocan en el mismo sitio en
 * verificar y crear para que los dos diagramas se lean igual.
 */
function cadena(cliente, codigo) {
  const nodos = [
    webhookNode(
      'Webhook Widget',
      'unyx-' + codigo + '-webhook',
      [0, 300],
      cliente.slug + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead'),
      'b1a7c3d5-000' + (codigo === 'v' ? '1' : '2') + '-4a6b-8c9d-0e1f2a3b4c0' + (codigo === 'v' ? '1' : '2')
    ),
    ifNode('¿Autorizado?', 'unyx-' + codigo + '-autorizado', [220, 300], ifAutorizado(cliente)),
    codeNode('Acceso Denegado', 'unyx-' + codigo + '-denegado', [440, 560], read('acceso-denegado.js')),
    ifNode('Teléfono Válido', 'unyx-' + codigo + '-telefono', [440, 300], IF_PHONE),
    codeNode('Teléfono Inválido', 'unyx-' + codigo + '-telefono-err', [660, 560], read('invalido.js')),
    codeNode('Preparar Consultas', 'unyx-' + codigo + '-preparar', [660, 180], scoped(read('preparar-consultas.js'), cliente)),
    httpNode(cliente, 'Buscar Contactos', 'unyx-' + codigo + '-contactos', [880, 180], {
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
    codeNode('Unificar Contactos', 'unyx-' + codigo + '-unificar', [1100, 180], scoped(read('unificar-contactos.js'), cliente)),
    httpNode(cliente, 'Usuarios Kommo', 'unyx-' + codigo + '-usuarios', [1320, 180], {
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
    codeNode('Consolidar', 'unyx-' + codigo + '-consolidar', [1540, 180], scoped(read('consolidar.js'), cliente)),
    ifNode('¿Tiene Leads?', 'unyx-' + codigo + '-tiene-leads', [1760, 180], IF_HAS_LEADS),
    httpNode(cliente, 'Obtener Leads', 'unyx-' + codigo + '-leads', [1980, 80], {
      method: 'GET',
      // El '=' inicial es obligatorio: sin él n8n manda la expresión como texto
      // literal, Kommo ignora el filtro y devuelve los primeros 250 leads de la
      // cuenta en vez de los leads de este contacto.
      url:
        '=' +
        KOMMO_HOST(cliente.subdominio) +
        '/api/v4/leads?limit=250&{{ $json.leadIds.map((id) => "filter[id][]=" + id).join("&") }}',
    }),
    codeNode(
      'Evaluar Atención',
      'unyx-' + codigo + '-evaluar',
      [2200, 80],
      scoped(read('_comun.js') + '\n\n' + read(codigo === 'v' ? 'evaluar-verificar.js' : 'evaluar-crear.js'), cliente)
    ),
    respondNode(RESPONDER, 'unyx-' + codigo + '-responder', [2600, 340]),
  ];

  const conexiones = {
    'Webhook Widget': { main: [[{ node: '¿Autorizado?', type: 'main', index: 0 }]] },
    '¿Autorizado?': {
      main: [
        [{ node: 'Teléfono Válido', type: 'main', index: 0 }],
        [{ node: 'Acceso Denegado', type: 'main', index: 0 }],
      ],
    },
    'Acceso Denegado': { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] },
    'Teléfono Válido': {
      main: [
        [{ node: 'Preparar Consultas', type: 'main', index: 0 }],
        [{ node: 'Teléfono Inválido', type: 'main', index: 0 }],
      ],
    },
    'Teléfono Inválido': { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] },
    'Preparar Consultas': { main: [[{ node: 'Buscar Contactos', type: 'main', index: 0 }]] },
    'Buscar Contactos': { main: [[{ node: 'Unificar Contactos', type: 'main', index: 0 }]] },
    'Unificar Contactos': { main: [[{ node: 'Usuarios Kommo', type: 'main', index: 0 }]] },
    'Usuarios Kommo': { main: [[{ node: 'Consolidar', type: 'main', index: 0 }]] },
    'Consolidar': { main: [[{ node: '¿Tiene Leads?', type: 'main', index: 0 }]] },
    'Obtener Leads': { main: [[{ node: 'Evaluar Atención', type: 'main', index: 0 }]] },
  };

  return { nodos, conexiones };
}

function nota(cliente, codigo) {
  const ruta = cliente.slug + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead');
  const content =
    '## UNYX · ' + (codigo === 'v' ? 'Verificar Cliente' : 'Crear Lead') + ' — ' + cliente.nombre + '\n' +
    'Cuenta: `' + cliente.subdominio + '.kommo.com` · Webhook: `' + ruta + '`\n\n' +
    '**Antes de activar:** abrir `¿Autorizado?` y reemplazar `' + cliente.tokenWidget + '`\n' +
    'por el token real del widget. Mientras quede el placeholder, todo cae en `Acceso Denegado`.\n\n' +
    'Los nodos HTTP usan la credencial «' + cliente.credencial.name + '». Si al importar\n' +
    'aparece sin credencial, hay que elegirla a mano (pasa cuando el id no existe en la instancia).\n\n' +
    (codigo === 'v'
      ? '- **Atención activa = lead sin `closed_at`**, salvo pipelines excluidos.\n' +
        '- `filter[contacts][]` NO existe en la API v4: se usan los ids de `with=leads`.\n'
      : 'Re-valida justo antes de crear para evitar duplicados por concurrencia.\n' +
        '- Reutiliza el contacto existente; si no existe, lo crea con el campo PHONE.\n' +
        '- El lead se asigna al asesor del contexto (`userId` = `self.system().user_id`).\n' +
        '- Sin pipeline_id ni status_id: Kommo usa la primera etapa del pipeline principal.\n\n' +
        '**Concurrencia:** la revalidación reduce la ventana de carrera. Si tu versión de n8n\n' +
        'permite limitar la concurrencia del workflow a 1, actívalo para cerrarla del todo.\n') +
    'Generado por `unyx/n8n/build.js`: no editar este JSON a mano (salvo el token del nodo «¿Autorizado?»).';

  return note(content, [0, 40], codigo === 'v' ? 400 : 440);
}

function workflowVerificar(cliente) {
  const { nodos, conexiones } = cadena(cliente, 'v');

  nodos.push(
    codeNode('Sin Leads Activos', 'unyx-v-sin-leads', [1980, 340], scoped(read('sin-leads-activos.js'), cliente)),
    nota(cliente, 'v')
  );

  conexiones['¿Tiene Leads?'] = {
    main: [
      [{ node: 'Obtener Leads', type: 'main', index: 0 }],
      [{ node: 'Sin Leads Activos', type: 'main', index: 0 }],
    ],
  };
  conexiones['Evaluar Atención'] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  conexiones['Sin Leads Activos'] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Verificar Cliente',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxVerif-' + cliente.slug,
    tags: [],
  };
}

function workflowCrear(cliente) {
  const { nodos, conexiones } = cadena(cliente, 'c');

  nodos.push(
    ifNode('¿Disponible?', 'unyx-c-disponible', [2420, 180], '$json.state === "available"'),
    ifNode('¿Existe Contacto?', 'unyx-c-existe-contacto', [2640, 80], '$json.contactId !== null && $json.contactId !== undefined'),
    httpNode(cliente, 'Campos Contacto', 'unyx-c-campos', [2860, 300], {
      method: 'GET',
      // Ruta documentada: /api/v4/{entidad}/custom_fields (no /contacts/fields).
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts/custom_fields',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    }),
    httpNode(cliente, 'Crear Contacto', 'unyx-c-crear-contacto', [3080, 300], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: ($(\'Evaluar Atención\').first().json.contactName || $(\'Evaluar Atención\').first().json.phone), responsible_user_id: $(\'Evaluar Atención\').first().json.userId, created_by: $(\'Evaluar Atención\').first().json.userId, custom_fields_values: [{ field_id: (($json._embedded && $json._embedded.custom_fields ? $json._embedded.custom_fields : []).find((f) => String(f.code || "").toUpperCase() === "PHONE") || {}).id, values: [{ value: $(\'Evaluar Atención\').first().json.phone, enum_code: "WORK" }] }] }]) }}',
    }),
    codeNode('Extraer Contacto', 'unyx-c-extraer', [3300, 300], scoped(read('extraer-contacto.js'), cliente)),
    httpNode(cliente, 'Crear Lead', 'unyx-c-crear-lead', [3520, 80], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/leads',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: $json.leadName, responsible_user_id: $json.userId, created_by: $json.userId, updated_by: $json.userId, _embedded: { contacts: [{ id: $json.contactId, is_main: true }] } }]) }}',
    }),
    codeNode('Resultado', 'unyx-c-resultado', [3740, 80], scoped(read('resultado.js'), cliente)),
    codeNode('Bloqueado', 'unyx-c-bloqueado', [2640, 460], scoped(read('bloqueado.js'), cliente)),
    nota(cliente, 'c')
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
  conexiones['Resultado'] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  conexiones['Bloqueado'] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };

  return {
    name: 'UNYX - ' + cliente.nombre + ' - Crear Lead',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: 'UnyxCrear-' + cliente.slug,
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

const invalidos = clientes.filter(
  (cliente) => !cliente.slug || !cliente.nombre || !cliente.subdominio || !cliente.tokenWidget ||
    !cliente.credencial || !cliente.credencial.id || !cliente.credencial.name
);
if (invalidos.length) {
  console.error('Clientes incompletos (faltan slug, nombre, subdominio, tokenWidget o credencial):');
  invalidos.forEach((cliente) => console.error('  - ' + (cliente.nombre || cliente.slug || '(sin nombre)')));
  process.exit(1);
}

for (const cliente of clientes) {
  console.log('Cliente ' + cliente.nombre + ' (' + cliente.subdominio + '.kommo.com)');
  console.log('  webhook del widget = https://flow.unyxsolutions.com/webhook/' + cliente.slug);
  console.log('  credencial de n8n  = ' + cliente.credencial.name + '  [' + credencialTipo(cliente) + ']');
  console.log('  token del widget   = ' + cliente.tokenWidget + '  (se pega en n8n, no aquí)');
  writeWorkflow(cliente.slug + '-verificar-cliente.json', workflowVerificar(cliente));
  writeWorkflow(cliente.slug + '-crear-lead.json', workflowCrear(cliente));
  console.log('');
}
