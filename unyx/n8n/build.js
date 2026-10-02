'use strict';

/**
 * Genera los DOS workflows de n8n con una RAMA POR CLIENTE:
 *   unyx-verificar-cliente.json
 *   unyx-crear-lead.json
 *
 * Estructura:
 *   Webhook → Switch Cliente (compara body.token)
 *              ├─ Meditec   → [IF cuenta] → cadena con credencial de Meditec
 *              ├─ Altosa    → [IF cuenta] → cadena con credencial de Altosa
 *              ├─ LuxViajes → [IF cuenta] → cadena con credencial de LuxViajes
 *              └─ (extra)   → Acceso Denegado → Responder
 *
 * Cada rama tiene sus propios nodos HTTP con la credencial de n8n de ese
 * cliente y la URL de su subdominio. No se usan variables de entorno.
 *
 * Uso: node unyx/n8n/build.js
 *
 * Aunque el JSON generado repite la cadena por cliente (el diseño lo pide así
 * para no necesitar SSH), el código no está duplicado: `rama()` construye las
 * ramas desde los mismos snippets y `scoped()` prefija las referencias entre
 * nodos. Cambiar una regla en code/_comun.js cambia las tres ramas.
 */

const fs = require('fs');
const path = require('path');

const CODE_DIR = path.join(__dirname, 'code');

const BASE_WEBHOOK = 'unyx';
const SWITCH = 'Switch Cliente';
const DENEGADO = 'Acceso Denegado';
const RESPONDER = 'Responder al Widget';
const KOMMO_HOST = (subdominio) => 'https://' + subdominio + '.kommo.com';

function read(name) {
  return fs.readFileSync(path.join(CODE_DIR, name), 'utf8').trim();
}

const CREDENCIAL_TIPOS = { httpHeaderAuth: true, httpBearerAuth: true };

function credencialTipo(cliente) {
  const tipo = cliente.credencial && cliente.credencial.tipo;
  return CREDENCIAL_TIPOS[tipo] ? tipo : 'httpHeaderAuth';
}

/** Nombre de nodo dentro de la rama de un cliente. */
function n(cliente, nombre) {
  return cliente.nombre + ' · ' + nombre;
}

/** Adapta un snippet a la rama: referencias entre nodos, subdominio y exclusiones. */
function scoped(snippet, cliente) {
  return snippet
    .replace(/\$\('__N_([A-Z_]+)__'\)/g, (match, clave) => {
      const nombres = {
        PREPARAR: 'Preparar Consultas',
        UNIFICAR: 'Unificar Contactos',
        USUARIOS: 'Usuarios Kommo',
        CONSOLIDAR: 'Consolidar',
        LEADS: 'Obtener Leads',
        EVALUAR: 'Evaluar Atención',
      };
      if (!nombres[clave]) throw new Error('Placeholder de nodo desconocido: ' + clave);
      return "$('" + n(cliente, nombres[clave]) + "')";
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

/** Switch por token. El caso que no coincide va a la salida extra (fallback). */
function switchNode(name, id, position, clientes) {
  return {
    parameters: {
      rules: {
        values: clientes.map((cliente) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              {
                id: id + '-regla-' + cliente.slug,
                // String(...) evita que un body sin token rompa la condición.
                leftValue: '={{ String($json.body && $json.body.token || "") }}',
                rightValue: cliente.tokenSwitch,
                operator: { type: 'string', operation: 'equals' },
              },
            ],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: cliente.nombre,
        })),
      },
      // Ver documentación de n8n: con 'extra' los items que no casan ninguna
      // regla salen por una salida adicional en vez de descartarse.
      options: { fallbackOutput: 'extra' },
    },
    id,
    name,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.2,
    position,
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

const IF_PHONE = '/^(?:\\+?593)?0?9\\d{8}$/.test(String($json.body && $json.body.phone || "").replace(/[\\s\\-()]/g, ""))';
const IF_HAS_LEADS = '$json.leadIds.length > 0';

function ifAccount(cliente) {
  return 'String($json.body && $json.body.account || "").trim().toLowerCase() === "' + cliente.subdominio.toLowerCase() + '"';
}

/**
 * Construye la rama de un cliente y devuelve sus nodos, sus conexiones y el
 * nodo por el que entra la rama (la primera IF de cuenta).
 */
function rama(cliente, codigo, y) {
  const sufijo = '-' + codigo + '-' + cliente.slug;
  const nodos = [];
  const conexiones = {};

  const nodoCuenta = ifNode(n(cliente, '¿Cuenta Correcta?'), 'if-cuenta' + sufijo, [460, y], ifAccount(cliente));
  const nodoCuentaError = codeNode(n(cliente, 'Cuenta Incorrecta'), 'cd-cuenta-err' + sufijo, [680, y + 260], scoped(read('cuenta-incorrecta.js'), cliente));
  const nodoTelefono = ifNode(n(cliente, 'Teléfono Válido'), 'if-telefono' + sufijo, [680, y], IF_PHONE);
  const nodoTelefonoError = codeNode(n(cliente, 'Teléfono Inválido'), 'cd-telefono-err' + sufijo, [900, y + 260], scoped(read('invalido.js'), cliente));
  const nodoPreparar = codeNode(n(cliente, 'Preparar Consultas'), 'cd-preparar' + sufijo, [900, y], scoped(read('preparar-consultas.js'), cliente));
  const nodoContactos = httpNode(cliente, n(cliente, 'Buscar Contactos'), 'ht-contactos' + sufijo, [1120, y], {
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
  });
  const nodoUnificar = codeNode(n(cliente, 'Unificar Contactos'), 'cd-unificar' + sufijo, [1340, y], scoped(read('unificar-contactos.js'), cliente));
  const nodoUsuarios = httpNode(cliente, n(cliente, 'Usuarios Kommo'), 'ht-usuarios' + sufijo, [1560, y], {
    method: 'GET',
    url: KOMMO_HOST(cliente.subdominio) + '/api/v4/users',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
  }, {
    // Un token sin permisos de administrador devuelve 403: sin esto la
    // ejecución se detiene y la degradación de "Consolidar" nunca corre.
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  });
  const nodoConsolidar = codeNode(n(cliente, 'Consolidar'), 'cd-consolidar' + sufijo, [1780, y], scoped(read('consolidar.js'), cliente));
  const nodoTieneLeads = ifNode(n(cliente, '¿Tiene Leads?'), 'if-tiene-leads' + sufijo, [2000, y], IF_HAS_LEADS);
  const nodoLeads = httpNode(cliente, n(cliente, 'Obtener Leads'), 'ht-leads' + sufijo, [2220, y - 100], {
    method: 'GET',
    url: KOMMO_HOST(cliente.subdominio) + '/api/v4/leads?limit=250&{{ $json.leadIds.map((id) => "filter[id][]=" + id).join("&") }}',
  });
  const nodoEvaluar = codeNode(
    n(cliente, 'Evaluar Atención'),
    'cd-evaluar' + sufijo,
    [2440, y - 100],
    scoped(read('_comun.js') + '\n\n' + read(codigo === 'v' ? 'evaluar-verificar.js' : 'evaluar-crear.js'), cliente)
  );

  nodos.push(nodoCuenta, nodoCuentaError, nodoTelefono, nodoTelefonoError, nodoPreparar, nodoContactos, nodoUnificar, nodoUsuarios, nodoConsolidar, nodoTieneLeads, nodoLeads, nodoEvaluar);

  conexiones[nodoCuenta.name] = {
    main: [
      [{ node: nodoTelefono.name, type: 'main', index: 0 }],
      [{ node: nodoCuentaError.name, type: 'main', index: 0 }],
    ],
  };
  conexiones[nodoCuentaError.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  conexiones[nodoTelefono.name] = {
    main: [
      [{ node: nodoPreparar.name, type: 'main', index: 0 }],
      [{ node: nodoTelefonoError.name, type: 'main', index: 0 }],
    ],
  };
  conexiones[nodoTelefonoError.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  conexiones[nodoPreparar.name] = { main: [[{ node: nodoContactos.name, type: 'main', index: 0 }]] };
  conexiones[nodoContactos.name] = { main: [[{ node: nodoUnificar.name, type: 'main', index: 0 }]] };
  conexiones[nodoUnificar.name] = { main: [[{ node: nodoUsuarios.name, type: 'main', index: 0 }]] };
  conexiones[nodoUsuarios.name] = { main: [[{ node: nodoConsolidar.name, type: 'main', index: 0 }]] };
  conexiones[nodoConsolidar.name] = { main: [[{ node: nodoTieneLeads.name, type: 'main', index: 0 }]] };
  conexiones[nodoLeads.name] = { main: [[{ node: nodoEvaluar.name, type: 'main', index: 0 }]] };

  if (codigo === 'v') {
    const nodoSinLeads = codeNode(n(cliente, 'Sin Leads Activos'), 'cd-sin-leads' + sufijo, [2000, y + 160], scoped(read('sin-leads-activos.js'), cliente));
    nodos.push(nodoSinLeads);
    conexiones[nodoTieneLeads.name] = {
      main: [
        [{ node: nodoLeads.name, type: 'main', index: 0 }],
        [{ node: nodoSinLeads.name, type: 'main', index: 0 }],
      ],
    };
    conexiones[nodoEvaluar.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
    conexiones[nodoSinLeads.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  } else {
    const nodoDisponible = ifNode(n(cliente, '¿Disponible?'), 'if-disponible' + sufijo, [2440, y], '$json.state === "available"');
    const nodoExisteContacto = ifNode(n(cliente, '¿Existe Contacto?'), 'if-existe-contacto' + sufijo, [2660, y - 100], '$json.contactId !== null && $json.contactId !== undefined');
    const nodoCampos = httpNode(cliente, n(cliente, 'Campos Contacto'), 'ht-campos' + sufijo, [2880, y + 140], {
      method: 'GET',
      // Ruta documentada: /api/v4/{entidad}/custom_fields (no /contacts/fields).
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts/custom_fields',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'limit', value: '250' }] },
    });
    const evaluar = n(cliente, 'Evaluar Atención');
    const nodoCrearContacto = httpNode(cliente, n(cliente, 'Crear Contacto'), 'ht-crear-contacto' + sufijo, [3100, y + 140], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/contacts',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        "={{ JSON.stringify([{ name: ($('" + evaluar + "').first().json.contactName || $('" + evaluar + "').first().json.phone), responsible_user_id: $('" + evaluar + "').first().json.userId, created_by: $('" + evaluar + "').first().json.userId, custom_fields_values: [{ field_id: (($json._embedded && $json._embedded.custom_fields ? $json._embedded.custom_fields : []).find((f) => String(f.code || \"\").toUpperCase() === \"PHONE\") || {}).id, values: [{ value: $('" + evaluar + "').first().json.phone, enum_code: \"WORK\" }] }] }]) }}",
    });
    const nodoExtraer = codeNode(n(cliente, 'Extraer Contacto'), 'cd-extraer' + sufijo, [3320, y + 140], scoped(read('extraer-contacto.js'), cliente));
    const nodoCrearLead = httpNode(cliente, n(cliente, 'Crear Lead'), 'ht-crear-lead' + sufijo, [3540, y - 100], {
      method: 'POST',
      url: KOMMO_HOST(cliente.subdominio) + '/api/v4/leads',
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify([{ name: $json.leadName, responsible_user_id: $json.userId, created_by: $json.userId, updated_by: $json.userId, _embedded: { contacts: [{ id: $json.contactId, is_main: true }] } }]) }}',
    });
    const nodoResultado = codeNode(n(cliente, 'Resultado'), 'cd-resultado' + sufijo, [3760, y - 100], scoped(read('resultado.js'), cliente));
    const nodoBloqueado = codeNode(n(cliente, 'Bloqueado'), 'cd-bloqueado' + sufijo, [2660, y + 260], scoped(read('bloqueado.js'), cliente));

    nodos.push(nodoDisponible, nodoExisteContacto, nodoCampos, nodoCrearContacto, nodoExtraer, nodoCrearLead, nodoResultado, nodoBloqueado);

    conexiones[nodoTieneLeads.name] = {
      main: [
        [{ node: nodoLeads.name, type: 'main', index: 0 }],
        [{ node: nodoEvaluar.name, type: 'main', index: 0 }],
      ],
    };
    conexiones[nodoEvaluar.name] = { main: [[{ node: nodoDisponible.name, type: 'main', index: 0 }]] };
    conexiones[nodoDisponible.name] = {
      main: [
        [{ node: nodoExisteContacto.name, type: 'main', index: 0 }],
        [{ node: nodoBloqueado.name, type: 'main', index: 0 }],
      ],
    };
    conexiones[nodoExisteContacto.name] = {
      main: [
        [{ node: nodoCrearLead.name, type: 'main', index: 0 }],
        [{ node: nodoCampos.name, type: 'main', index: 0 }],
      ],
    };
    conexiones[nodoCampos.name] = { main: [[{ node: nodoCrearContacto.name, type: 'main', index: 0 }]] };
    conexiones[nodoCrearContacto.name] = { main: [[{ node: nodoExtraer.name, type: 'main', index: 0 }]] };
    conexiones[nodoExtraer.name] = { main: [[{ node: nodoCrearLead.name, type: 'main', index: 0 }]] };
    conexiones[nodoCrearLead.name] = { main: [[{ node: nodoResultado.name, type: 'main', index: 0 }]] };
    conexiones[nodoResultado.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
    conexiones[nodoBloqueado.name] = { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] };
  }

  return { nodos, conexiones, entrada: nodoCuenta.name };
}

function nota(clientes, codigo) {
  const ruta = BASE_WEBHOOK + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead');
  const lineas = clientes.map(
    (cliente) =>
      '- **' + cliente.nombre + '** → `' + cliente.subdominio + '.kommo.com` · credencial «' + cliente.credencial.name +
      '» · token del widget: `' + cliente.tokenSwitch + '`'
  );
  const content =
    '## UNYX · ' + (codigo === 'v' ? 'Verificar Cliente' : 'Crear Lead') + ' — una rama por cliente\n' +
    'Webhook: `' + ruta + '`\n\n' +
    '**Antes de activar:** abrir `' + SWITCH + '` y reemplazar cada valor `PEGAR_TOKEN_*\n' +
    'por el token real del widget de ese cliente. Los placeholders no coinciden con\n' +
    'ningún token, así que todo cae en `' + DENEGADO + '` hasta que se rellenen.\n\n' +
    'Cada rama usa la credencial de n8n de su cliente y la URL de su subdominio:\n' +
    lineas.join('\n') + '\n\n' +
    'Los nodos HTTP llevan la credencial seleccionada; si al importar aparece sin\n' +
    'credencial, hay que elegirla a mano (pasa cuando el id no existe en la instancia).\n\n' +
    (codigo === 'v'
      ? '- **Atención activa = lead sin `closed_at`**, salvo pipelines excluidos.\n' +
        '- `filter[contacts][]` NO existe en la API v4: se usan los ids de `with=leads`.\n'
      : 'Re-valida justo antes de crear para evitar duplicados por concurrencia.\n' +
        '- Reutiliza el contacto existente; si no existe, lo crea con el campo PHONE.\n' +
        '- Sin pipeline_id ni status_id: Kommo usa la primera etapa del pipeline principal.\n\n' +
        '**Concurrencia:** la revalidación reduce la ventana de carrera. Si tu versión de n8n\n' +
        'permite limitar la concurrencia del workflow a 1, actívalo para cerrarla del todo.\n') +
    'Generado por `unyx/n8n/build.js`: no editar este JSON a mano (salvo los tokens del Switch).';

  return note(content, [0, 40], codigo === 'v' ? 480 : 520);
}

function workflow(clientes, codigo) {
  const nodos = [
    webhookNode(
      'Webhook Widget',
      'unyx-' + codigo + '-webhook',
      [0, 400],
      BASE_WEBHOOK + (codigo === 'v' ? '/verificar-cliente' : '/crear-lead'),
      'b1a7c3d5-000' + (codigo === 'v' ? '1' : '2') + '-4a6b-8c9d-0e1f2a3b4c0' + (codigo === 'v' ? '1' : '2')
    ),
    switchNode(SWITCH, 'unyx-' + codigo + '-switch', [240, 400], clientes),
    codeNode(DENEGADO, 'unyx-' + codigo + '-denegado', [460, 900], read('acceso-denegado.js')),
    respondNode(RESPONDER, 'unyx-' + codigo + '-responder', [4300, 400]),
  ];

  const conexiones = {
    'Webhook Widget': { main: [[{ node: SWITCH, type: 'main', index: 0 }]] },
    [DENEGADO]: { main: [[{ node: RESPONDER, type: 'main', index: 0 }]] },
  };

  const ramas = [];
  clientes.forEach((cliente, indice) => {
    const construida = rama(cliente, codigo, 200 + indice * 620);
    nodos.push(...construida.nodos);
    Object.assign(conexiones, construida.conexiones);
    ramas.push(construida.entrada);
  });

  // El Switch tiene una salida por regla, en el mismo orden que clientes.json,
  // más una salida extra (la última) para los tokens que no coinciden.
  conexiones[SWITCH] = {
    main: [
      ...ramas.map((entrada) => [{ node: entrada, type: 'main', index: 0 }]),
      [{ node: DENEGADO, type: 'main', index: 0 }],
    ],
  };

  nodos.push(nota(clientes, codigo));

  return {
    name: 'UNYX - ' + (codigo === 'v' ? 'Verificar Cliente' : 'Crear Lead') + ' (una rama por cliente)',
    nodes: nodos,
    connections: conexiones,
    pinData: {},
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', callerPolicy: 'workflowsFromSameOwner' },
    id: codigo === 'v' ? 'UnyxVerificarCl' : 'UnyxCrearLead',
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
  (cliente) => !cliente.slug || !cliente.nombre || !cliente.subdominio || !cliente.tokenSwitch || !cliente.credencial || !cliente.credencial.id
);
if (invalidos.length) {
  console.error('Clientes incompletos (faltan slug, nombre, subdominio, tokenSwitch o credencial.id):');
  invalidos.forEach((cliente) => console.error('  - ' + (cliente.nombre || cliente.slug || '(sin nombre)')));
  process.exit(1);
}

console.log('Ramas del Switch (el orden define las salidas):');
clientes.forEach((cliente, indice) => {
  console.log(
    '  [' + indice + '] ' + cliente.nombre.padEnd(12) + (cliente.subdominio + '.kommo.com').padEnd(28) +
    'cred: ' + cliente.credencial.name.padEnd(24) + 'token: ' + cliente.tokenSwitch
  );
});
console.log('  [extra] tokens que no coinciden → ' + DENEGADO);
console.log('');
console.log('Webhook: https://flow.unyxsolutions.com/webhook/' + BASE_WEBHOOK);
console.log('');
writeWorkflow('unyx-verificar-cliente.json', workflow(clientes, 'v'));
writeWorkflow('unyx-crear-lead.json', workflow(clientes, 'c'));
