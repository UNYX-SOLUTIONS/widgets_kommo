// =============================================================
// UNYX · Verificar Cliente — Nodo "Consolidar"
// Junta los datos del contacto con los nombres de los usuarios y con la
// configuración del cliente resuelta por token.
//
// No consulta pipelines ni etapas: la regla de atención activa se basa en
// closed_at (ver _comun.js).
// =============================================================
const base = $('Unificar Contactos').first().json;
const resolver = $('Resolver Cliente').first().json;

const userMap = {};
try {
  const users = $('Usuarios Kommo').first().json?._embedded?.users ?? [];
  for (const user of users) userMap[user.id] = user.name;
} catch (error) {
  // Sin permisos de administrador la lista de usuarios puede fallar:
  // se degrada a mostrar solo los ids.
}

return [{
  json: {
    ...base,
    cliente: resolver.cliente,
    subdomain: resolver.subdominio,
    pipelinesExcluidos: resolver.pipelinesExcluidos || [],
    userMap,
  },
}];
