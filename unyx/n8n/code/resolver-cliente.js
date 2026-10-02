// =============================================================
// UNYX · Verificar Cliente — Nodo "Resolver Cliente"
//
// Un solo workflow atiende a todos los clientes. Este nodo hace de switch:
// compara el token que envía el widget contra el token de cada cliente
// (guardado en una variable de entorno de n8n) y devuelve la configuración
// de ese cliente para el resto de la cadena.
//
// Si el token no corresponde a ningún cliente, o la cuenta no coincide, o
// falta el token de Kommo, responde ok:false y el nodo "¿Autorizado?" manda
// el caso al respondedor. Nada de esto toca la API de Kommo.
//
// Todo falla cerrado: una variable de entorno ausente deja al cliente sin
// token y ninguna petición coincide.
// =============================================================
const CLIENTES = __CLIENTES__;

const body = $json.body || $json;
const token = String(body.token || '');
const account = String(body.account || '').trim().toLowerCase();

const cliente = token ? CLIENTES.find((item) => item.secreto && item.secreto === token) : null;

if (!cliente) {
  return [{ json: { ok: false, message: 'Acceso no autorizado. Revise el token del widget.' } }];
}

if (cliente.subdominio !== account) {
  return [{
    json: {
      ok: false,
      message: 'El token no corresponde a esta cuenta de Kommo (' + account + ').',
    },
  }];
}

if (!cliente.kommoToken) {
  return [{
    json: {
      ok: false,
      message: 'Falta el token de Kommo de ' + cliente.nombre + ' en el entorno de n8n.',
    },
  }];
}

// Se arma la salida campo por campo: el token del widget no se propaga.
return [{
  json: {
    autorizado: true,
    cliente: cliente.nombre,
    subdominio: cliente.subdominio,
    kommoToken: cliente.kommoToken,
    pipelinesExcluidos: cliente.pipelinesExcluidos || [],
    phone: String(body.phone || ''),
    userId: parseInt(body.userId || 0, 10) || 0,
    userName: String(body.userName || '').trim(),
  },
}];
