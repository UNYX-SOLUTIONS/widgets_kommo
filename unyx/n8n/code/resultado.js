// =============================================================
// UNYX · Crear Lead — Nodo "Resultado"
// Arma la respuesta final del widget con el lead creado.
// =============================================================
const created = $json?._embedded?.leads?.[0];
const base = $('Evaluar Atención').first().json;
const subdominio = $('Resolver Cliente').first().json.subdominio;

return [{
  json: {
    ok: true,
    leadId: created?.id ?? null,
    leadName: base.leadName,
    contactId: base.contactId,
    leadUrl: 'https://' + subdominio + '.kommo.com/leads/' + (created?.id ?? ''),
  },
}];
