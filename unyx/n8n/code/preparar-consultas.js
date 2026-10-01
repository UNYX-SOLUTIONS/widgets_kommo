// =============================================================
// UNYX · Verificar Cliente — Nodo "Preparar Consultas"
// Normaliza el celular ecuatoriano y genera una consulta por variante.
// El webhook recibe el body como formulario (self.crm_post de Kommo) o JSON.
// =============================================================
const body = $json.body || $json;

const digits = String(body.phone || '').replace(/\D/g, '');
let local = digits;
if (local.startsWith('593')) local = local.slice(3);
if (local.startsWith('0')) local = local.slice(1);

if (!/^9\d{8}$/.test(local)) {
  throw new Error('Teléfono inválido: se esperaban 9 dígitos de celular ecuatoriano.');
}

const phone = '+593' + local;
const userId = parseInt(body.userId || 0, 10) || 0;
const userName = String(body.userName || '').trim();

// Kommo busca por texto libre sobre los campos personalizados: se consultan
// las tres formas habituales de guardar el número y luego se compara exacto.
const variants = [local, '0' + local, phone];

return variants.map((variant) => ({
  json: { variant, phone, local, userId, userName },
}));
