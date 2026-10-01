// =============================================================
// UNYX · Verificar Cliente — Reglas compartidas
// Este archivo NO se ejecuta solo: build.js lo antepone a los nodos que
// evalúan leads, para que la regla de "atención activa" viva en un solo lugar.
//
// REGLA: un lead está ACTIVO si no tiene closed_at.
// Kommo marca closed_at cuando el lead se cierra (ganado o perdido) y lo
// limpia si se reabre. Por eso no hace falta consultar pipelines ni etapas:
// la regla funciona igual en cualquier cuenta y en cualquier pipeline.
// =============================================================

function unyxIsActive(lead, data) {
  if (!lead || lead.is_deleted) return false;
  if (data && (data.pipelinesExcluidos || []).includes(lead.pipeline_id)) return false;
  return !lead.closed_at;
}

function unyxDecorate(lead, data) {
  return {
    id: lead.id,
    name: lead.name || '#' + lead.id,
    created_at: lead.created_at || 0,
    responsible_user_id: lead.responsible_user_id || 0,
    responsibleName: data.userMap[lead.responsible_user_id] || '',
    leadUrl: 'https://' + data.subdomain + '.kommo.com/leads/' + lead.id,
  };
}

// Devuelve solo las atenciones activas, de la más reciente a la más antigua.
function unyxActiveLeads(leads, data) {
  return (leads || [])
    .filter((lead) => unyxIsActive(lead, data))
    .map((lead) => unyxDecorate(lead, data))
    .sort((a, b) => b.created_at - a.created_at);
}

function unyxClosedCount(leads, data) {
  const excluded = (data && data.pipelinesExcluidos) || [];
  return (leads || []).filter(
    (lead) => lead && !lead.is_deleted && !excluded.includes(lead.pipeline_id) && lead.closed_at
  ).length;
}

// Regla de decisión compartida por los dos workflows.
function unyxResolveState(active, userId) {
  if (active.length > 1) return { state: 'multiple_leads', activeLead: null };
  if (active.length === 1) {
    return {
      state: active[0].responsible_user_id === userId ? 'same_agent' : 'other_agent',
      activeLead: active[0],
    };
  }
  return { state: 'available', activeLead: null };
}
