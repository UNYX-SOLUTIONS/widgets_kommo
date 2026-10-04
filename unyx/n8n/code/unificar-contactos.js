// =============================================================
// UNYX · Verificar Cliente — Nodo "Unificar Contactos"
// Recibe la respuesta de cada variante, deduplica por id y descarta los
// contactos cuyo teléfono no coincide con el buscado.
// Recoge también los ids de los leads enlazados (with=leads).
//
// La comparación es por dígitos y admite las formas habituales de guardar un
// número: la parte nacional, con 0 inicial, o con su código de país delante.
// =============================================================
const first = $('__N_PREPARAR__').first().json;
const target = first.local;
const full = String(first.country || '') + target;

function digitsOf(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
}

function phonesMatch(value) {
  const candidate = digitsOf(value);
  if (!candidate || candidate.length < 6 || candidate.length > 15) return false;
  if (candidate === target) return true;
  if (candidate === '0' + target) return true;
  if (candidate === full) return true;
  // El código de país delante (1 a 3 dígitos: +1, +57, +593).
  return candidate.endsWith(target) && candidate.length - target.length <= 3;
}

const contactsById = new Map();

for (const item of $input.all()) {
  const contacts = item.json?._embedded?.contacts ?? [];
  for (const contact of contacts) {
    if (!contact || contact.is_deleted) continue;
    const phones = [];
    for (const field of contact.custom_fields_values ?? []) {
      for (const entry of field.values ?? []) {
        if (entry && entry.value !== undefined && entry.value !== null) phones.push(entry.value);
      }
    }
    if (phones.some(phonesMatch)) contactsById.set(contact.id, contact);
  }
}

const contacts = [...contactsById.values()];
const leadIds = [];

for (const contact of contacts) {
  for (const lead of contact._embedded?.leads ?? []) {
    if (lead && lead.id && !leadIds.includes(lead.id)) leadIds.push(lead.id);
  }
}

return [{
  json: {
    phone: first.phone,
    country: first.country,
    userId: first.userId,
    userName: first.userName,
    contactCount: contacts.length,
    contactName: contacts[0]?.name ?? '',
    contactIds: contacts.map((contact) => contact.id),
    contacts: contacts.map((contact) => ({ id: contact.id, name: contact.name ?? '' })),
    leadIds,
  },
}];
