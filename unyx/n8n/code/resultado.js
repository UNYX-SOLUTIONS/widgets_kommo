// =============================================================
// UNYX · Crear Lead — Nodo "Resultado"
// Arma la respuesta final del widget con el lead creado.
// =============================================================
const created = $json?._embedded?.leads?.[0];
const base = $('Evaluar Atención').first().json;

return [{
  json: {
    ok: true,
    leadId: created?.id ?? null,
    leadName: base.leadName,
    contactId: base.contactId,
    leadUrl: 'https://__SUBDOMINIO__.kommo.com/leads/' + (created?.id ?? ''),
  },
}];
