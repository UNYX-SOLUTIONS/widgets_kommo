// =============================================================
// UNYX · Crear Lead — Nodo "Evaluar Atención" (workflow: crear)
// RE-VALIDACIÓN: justo antes de crear el lead se vuelve a calcular el estado
// con datos frescos. Devuelve además el contacto a reutilizar y el nombre
// del lead, para que el nodo de creación no tenga que recalcular nada.
// =============================================================
const data = $('Consolidar').first().json;

let leads = [];
try {
  leads = $('Obtener Leads').first().json?._embedded?.leads ?? [];
} catch (error) {
  leads = [];
}

const active = unyxActiveLeads(leads, data);
const resolved = unyxResolveState(active, data.userId);
const contact = data.contacts?.[0] ?? null;

return [{
  json: {
    ok: true,
    state: resolved.state,
    phone: data.phone,
    userId: data.userId,
    userName: data.userName,
    contactId: contact ? contact.id : null,
    contactName: data.contactName,
    contactCount: data.contactCount,
    activeLead: resolved.activeLead,
    leads: resolved.state === 'multiple_leads' ? active : [],
    leadName: data.contactName ? data.contactName + ' · ' + data.phone : data.phone,
  },
}];
