// =============================================================
// UNYX · Verificar Cliente — Nodo "Consolidar"
// Junta los datos del contacto con los nombres de los usuarios y con las
// constantes del cliente de esta rama (subdominio y pipelines excluidos).
//
// No consulta pipelines ni etapas: la regla de atención activa se basa en
// closed_at (ver _comun.js).
// =============================================================
const base = $('__N_UNIFICAR__').first().json;

const userMap = {};
try {
  const users = $('__N_USUARIOS__').first().json?._embedded?.users ?? [];
  for (const user of users) userMap[user.id] = user.name;
} catch (error) {
  // Sin permisos de administrador la lista de usuarios puede fallar:
  // se degrada a mostrar solo los ids.
}

return [{
  json: {
    ...base,
    subdomain: '__SUBDOMINIO__',
    pipelinesExcluidos: __PIPELINES_EXCLUIDOS__,
    userMap,
  },
}];
