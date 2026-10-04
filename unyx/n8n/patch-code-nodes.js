'use strict';

/**
 * Actualiza en un workflow ya importado los nodos Code que NO dependen del
 * cliente, conservando todo lo demás: token del widget, credencial, ids y
 * posiciones. Sirve para no tener que regenerar con build.js (que volvería a
 * poner los placeholders) cuando el cambio es solo de lógica.
 *
 * Solo toca los nodos listados en MAPA. Si el cambio afecta a un valor por
 * cliente (subdominio, pipelines excluidos), hay que regenerar con build.js.
 *
 * Uso: node unyx/n8n/patch-code-nodes.js <workflow.json> [más archivos...]
 */

const fs = require('fs');
const path = require('path');

const CODE_DIR = path.join(__dirname, 'code');

// Nodo del workflow -> snippet de code/ que lo implementa.
const MAPA = {
  'Preparar Consultas': 'preparar-consultas.js',
  'Unificar Contactos': 'unificar-contactos.js',
  'Teléfono Inválido': 'invalido.js',
};

// La condición del IF "Teléfono Válido" también se comparte con build.js.
const IF_TELEFONO = 'if-telefono.txt';

// Las referencias entre nodos van con placeholder en code/ y aquí se resuelven
// al nombre real. En el modelo de un cliente por workflow los nombres son
// planos, igual que los genera build.js.
const NOMBRES = {
  PREPARAR: 'Preparar Consultas',
  UNIFICAR: 'Unificar Contactos',
  USUARIOS: 'Usuarios Kommo',
  CONSOLIDAR: 'Consolidar',
  LEADS: 'Obtener Leads',
  EVALUAR: 'Evaluar Atención',
};

// Valores que dependen del cliente: si aparecen, hay que regenerar con build.js.
const DEPENDE_DEL_CLIENTE = /__SUBDOMINIO__|__PIPELINES_EXCLUIDOS__|__CLIENTE__/;

function resolver(snippet) {
  if (DEPENDE_DEL_CLIENTE.test(snippet)) {
    throw new Error('El snippet tiene valores por cliente: usa build.js, no el patcher.');
  }
  return snippet.replace(/\$\('__N_([A-Z_]+)__'\)/g, (match, clave) => {
    if (!NOMBRES[clave]) throw new Error('Placeholder de nodo desconocido: ' + clave);
    return "$('" + NOMBRES[clave] + "')";
  });
}

const archivos = process.argv.slice(2);

if (!archivos.length) {
  console.error('Uso: node unyx/n8n/patch-code-nodes.js <workflow.json> [más archivos...]');
  process.exit(1);
}

let salida = 0;

for (const archivo of archivos) {
  if (!fs.existsSync(archivo)) {
    console.error('  no existe: ' + archivo);
    salida = 1;
    continue;
  }

  const workflow = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const cambios = [];

  for (const node of workflow.nodes) {
    const snippet = MAPA[node.name];
    if (snippet && node.type === 'n8n-nodes-base.code') {
      const nuevo = resolver(fs.readFileSync(path.join(CODE_DIR, snippet), 'utf8').trim());
      if (node.parameters.jsCode !== nuevo) {
        node.parameters.jsCode = nuevo;
        cambios.push(node.name);
      }
      continue;
    }

    // La condición del IF del teléfono se comparte con build.js.
    if (node.name === 'Teléfono Válido' && node.type === 'n8n-nodes-base.if') {
      const expresion = fs.readFileSync(path.join(CODE_DIR, IF_TELEFONO), 'utf8').trim();
      const esperado = '={{ ' + expresion + ' }}';
      if (node.parameters.conditions.conditions[0].leftValue !== esperado) {
        node.parameters.conditions.conditions[0].leftValue = esperado;
        cambios.push(node.name);
      }
    }
  }

  if (cambios.length) {
    fs.writeFileSync(archivo, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
  }

  console.log('  ' + path.basename(archivo) + ': ' + (cambios.length ? cambios.join(', ') : 'ya estaba al día'));
}

process.exit(salida);
