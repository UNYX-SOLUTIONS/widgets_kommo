// =============================================================
// UNYX · Verificar Cliente — Nodo "Sin Leads Activos" (workflow: verificar)
// Respuesta cuando el contacto no tiene ningún lead enlazado.
// =============================================================
const data = $('Consolidar').first().json;

return [{
  json: {
    ok: true,
    state: 'available',
    phone: data.phone,
    contactName: data.contactName,
    contactCount: data.contactCount,
    closedLeadCount: 0,
    activeLead: null,
    leads: [],
  },
}];
