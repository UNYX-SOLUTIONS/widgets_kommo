// =============================================================
// UNYX · Verificar Cliente — Nodo "Unificar Contactos"
// Recibe la respuesta de cada variante, deduplica por id y descarta los
// contactos cuyo teléfono no coincide exactamente con el buscado.
// Recoge también los ids de los leads enlazados (with=leads).
// =============================================================
const first = $('Preparar Consultas').first().json;
const target = first.local;

function digitsOf(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
}

function phonesMatch(value) {
  let candidate = digitsOf(value);
  if (!candidate || candidate.length < 7 || candidate.length > 15) return false;
  if (candidate.startsWith('593')) candidate = candidate.slice(3);
  if (candidate.startsWith('0')) candidate = candidate.slice(1);
  return candidate === target;
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
    userId: first.userId,
    userName: first.userName,
    contactCount: contacts.length,
    contactName: contacts[0]?.name ?? '',
    contactIds: contacts.map((contact) => contact.id),
    contacts: contacts.map((contact) => ({ id: contact.id, name: contact.name ?? '' })),
    leadIds,
  },
}];
