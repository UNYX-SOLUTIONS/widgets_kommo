// =============================================================
// UNYX · Crear Lead — Nodo "Bloqueado"
// Llegó una atención activa entre la verificación del asesor y la creación.
// Se responde ok:false con el estado real para que el widget lo muestre.
// =============================================================
const data = $json;

const messages = {
  same_agent: 'Este cliente ya tiene una atención activa asignada a usted.',
  other_agent: 'Este cliente está siendo atendido por otro asesor.',
  multiple_leads: 'Este cliente tiene varias atenciones activas. Revise el historial antes de crear otra.',
};

return [{
  json: {
    ok: false,
    state: data.state,
    message: messages[data.state] || 'Hay una atención activa para este cliente. No se creó el lead.',
    activeLead: data.activeLead ?? null,
    leads: data.leads ?? [],
    contactName: data.contactName ?? '',
  },
}];
