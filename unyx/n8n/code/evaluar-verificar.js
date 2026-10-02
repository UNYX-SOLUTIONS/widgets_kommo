// =============================================================
// UNYX · Verificar Cliente — Nodo "Evaluar Atención" (workflow: verificar)
// Determina el estado y arma la respuesta que consume el widget.
// Requiere las reglas compartidas (_comun.js), que build.js antepone.
// =============================================================
const data = $('__N_CONSOLIDAR__').first().json;
const leads = $('__N_LEADS__').first().json?._embedded?.leads ?? [];

const active = unyxActiveLeads(leads, data);
const resolved = unyxResolveState(active, data.userId);

return [{
  json: {
    ok: true,
    state: resolved.state,
    phone: data.phone,
    contactName: data.contactName,
    contactCount: data.contactCount,
    closedLeadCount: unyxClosedCount(leads, data),
    activeLead: resolved.activeLead,
    leads: resolved.state === 'multiple_leads' ? active : [],
  },
}];
