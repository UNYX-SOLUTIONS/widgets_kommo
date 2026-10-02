// =============================================================
// UNYX · Verificar Cliente — Nodo "Resultado"
// Arma la respuesta final del widget con el lead creado.
// =============================================================
const created = $json?._embedded?.leads?.[0];
const base = $('__N_EVALUAR__').first().json;

return [{
  json: {
    ok: true,
    leadId: created?.id ?? null,
    leadName: base.leadName,
    contactId: base.contactId,
    leadUrl: 'https://__SUBDOMINIO__.kommo.com/leads/' + (created?.id ?? ''),
  },
}];
