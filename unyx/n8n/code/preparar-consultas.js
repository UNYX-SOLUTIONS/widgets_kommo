// =============================================================
// UNYX · Verificar Cliente — Nodo "Preparar Consultas"
// Normaliza el celular ecuatoriano y genera una consulta por variante.
// Los datos ya vienen validados y aplanados por "Resolver Cliente".
// =============================================================
const digits = String($json.phone || '').replace(/\D/g, '');
let local = digits;
if (local.startsWith('593')) local = local.slice(3);
if (local.startsWith('0')) local = local.slice(1);

if (!/^9\d{8}$/.test(local)) {
  throw new Error('Teléfono inválido: se esperaban 9 dígitos de celular ecuatoriano.');
}

const phone = '+593' + local;

// Kommo busca por texto libre sobre los campos personalizados: se consultan
// las tres formas habituales de guardar el número y luego se compara exacto.
const variants = [local, '0' + local, phone];

return variants.map((variant) => ({
  json: {
    variant,
    phone,
    local,
    userId: $json.userId,
    userName: $json.userName,
    subdominio: $json.subdominio,
  },
}));
