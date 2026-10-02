// =============================================================
// UNYX · Crear Lead — Nodo "Extraer Contacto"
// Toma el id del contacto recién creado y lo mezcla con los datos del lead
// que vienen de la evaluación, para que el nodo de creación reciba lo mismo
// por las dos ramas (contacto existente / contacto nuevo).
// =============================================================
const base = $('Evaluar Atención').first().json;
const created = $json?._embedded?.contacts?.[0];

return [{
  json: {
    ...base,
    contactId: created?.id ?? null,
    contactCreated: true,
  },
}];
