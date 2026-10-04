// =============================================================
// UNYX · Verificar Cliente — Nodo "Preparar Consultas"
//
// Normaliza el teléfono y genera una consulta por variante.
// El widget envía el número en formato internacional (+573001234567) junto con
// el código de país (`country`), así que la parte nacional se calcula sin
// adivinar. Si `country` no viene (widget anterior), se asume Ecuador.
// =============================================================
const body = $json.body || $json;

const digits = String(body.phone || '').replace(/\D/g, '');
const country = String(body.country || '').replace(/\D/g, '');

// Compatibilidad: un widget anterior solo mandaba +593, y una integración que
// mande el número nacional suelto (9 dígitos empezando por 9, con 0 opcional)
// se interpreta como Ecuador.
const pais = country || (digits.startsWith('593') ? '593' : /^0?9\d{8}$/.test(digits) ? '593' : '');

let local = pais && digits.startsWith(pais) ? digits.slice(pais.length) : digits;

// Los celulares ecuatorianos se escriben a veces con 0 inicial (0963925815).
if (pais === '593' && local.startsWith('0')) local = local.slice(1);

if (pais === '593') {
  if (!/^9\d{8}$/.test(local)) {
    throw new Error('Teléfono inválido: se esperaban 9 dígitos de celular ecuatoriano.');
  }
} else if (!/^\d{6,12}$/.test(local)) {
  throw new Error('Teléfono inválido: se esperaban entre 6 y 12 dígitos.');
}

const full = pais + local;

// Kommo busca por texto libre sobre los campos personalizados: se consultan
// las formas habituales de guardar el número y luego se compara exacto.
const variants = [local, '0' + local, full];

return variants.map((variant) => ({
  json: {
    variant,
    phone: '+' + full,
    local,
    country: pais,
    userId: parseInt(body.userId || 0, 10) || 0,
    userName: String(body.userName || '').trim(),
  },
}));
