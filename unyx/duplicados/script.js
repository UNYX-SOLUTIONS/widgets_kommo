/* UNYX · Verificar Cliente
 * El widget solo habla con el backend UNYX. Nunca incluir aquí el token OAuth de Kommo.
 * Configure API_BASE en el servidor y exponga POST /api/kommo/client-check y
 * POST /api/kommo/leads. Consulte README.md para contrato y despliegue.
 */
(function () {
  'use strict';

  const API_BASE = window.UNYX_WIDGET_API || '';
  const root = document.getElementById('unyx-widget');
  if (!root) return;

  let checkedPhone = '';
  let latestResult = null;

  const q = (selector) => root.querySelector(selector);
  const views = [...root.querySelectorAll('[data-view]')];
  function show(name) {
    views.forEach((view) => { view.hidden = view.dataset.view !== name; });
  }
  function cleanPhone() { return q('#phone').value.replace(/\D/g, ''); }
  function fullPhone() { return '+593' + cleanPhone(); }
  function alertBox(kind, title, text, extra = '') {
    show('result');
    q('#result').className = 'status ' + kind;
    q('#result-title').textContent = title;
    q('#result-copy').textContent = text;
    q('#result-extra').innerHTML = extra;
  }
  async function api(path, body) {
    if (!API_BASE) throw new Error('Falta configurar la URL del backend UNYX.');
    const response = await fetch(new URL(path, API_BASE), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'No se pudo completar la solicitud.');
    return data;
  }

  q('#phone').addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 9);
  });
  q('#phone').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') q('#verify').click();
  });

  q('#verify').addEventListener('click', async () => {
    const phone = cleanPhone();
    if (!/^9\d{8}$/.test(phone)) {
      q('#phone').setAttribute('aria-invalid', 'true');
      q('#phone').focus();
      return;
    }
    q('#phone').removeAttribute('aria-invalid');
    q('#verify').disabled = true;
    q('#verify').innerHTML = '<span class="spinner"></span>Verificando…';
    show('loading');
    try {
      const result = await api('/api/kommo/client-check', { phone: fullPhone() });
      checkedPhone = fullPhone();
      latestResult = result;
      renderCheck(result);
    } catch (error) {
      alertBox('error', 'No pudimos realizar la consulta', error.message || 'Inténtelo nuevamente en unos segundos.');
      q('#retry').hidden = false;
    } finally {
      q('#verify').disabled = false;
      q('#verify').textContent = 'Verificar cliente →';
    }
  });

  function renderCheck(result) {
    const lead = result.activeLead;
    const extra = [];
    if (result.contactName) extra.push('<div><b>Cliente:</b> ' + escapeHtml(result.contactName) + '</div>');
    if (lead) {
      extra.push('<div><b>Lead:</b> ' + escapeHtml(lead.name || ('#' + lead.id)) + '</div>');
      if (lead.statusName) extra.push('<div><b>Etapa:</b> ' + escapeHtml(lead.statusName) + '</div>');
      if (lead.responsibleName) extra.push('<div><b>Asesor:</b> ' + escapeHtml(lead.responsibleName) + '</div>');
    }
    if (result.state === 'available') {
      q('#create').hidden = false;
      alertBox('success', 'Cliente disponible', result.contactName ? 'No tiene una atención activa.' : 'No se encontraron atenciones activas para este número.', extra.join(''));
    } else if (result.state === 'same_agent') {
      q('#create').hidden = true;
      alertBox('info', 'Ya está en tu cartera', 'Este cliente tiene una atención activa asignada a usted.', extra.join(''));
    } else if (result.state === 'other_agent') {
      q('#create').hidden = true;
      alertBox('blocked', 'Cliente atendido por otro asesor', 'No se puede crear otro lead mientras exista una atención activa.', extra.join(''));
    } else if (result.state === 'multiple_leads') {
      q('#create').hidden = true;
      alertBox('warning', 'Hay varios leads asociados', 'Revisa el historial antes de continuar.', extra.join(''));
    } else {
      q('#create').hidden = true;
      alertBox('error', 'Respuesta no reconocida', 'Vuelve a intentar la consulta.');
    }
  }

  q('#create').addEventListener('click', async () => {
    if (!latestResult || latestResult.state !== 'available' || checkedPhone !== fullPhone()) return;
    q('#create').disabled = true;
    q('#create').textContent = 'Creando lead…';
    try {
      // El servidor vuelve a comprobar el estado antes de crear para evitar carreras.
      const created = await api('/api/kommo/leads', { phone: checkedPhone, checkId: latestResult.checkId });
      alertBox('success', 'Lead creado correctamente', 'El cliente fue asignado a usted.', '<div class="details">' + escapeHtml(created.leadName || 'Nuevo lead') + '</div>');
      q('#open-lead').hidden = !created.leadUrl;
      q('#open-lead').onclick = () => window.open(created.leadUrl, '_blank', 'noopener');
    } catch (error) {
      alertBox('error', 'No se pudo crear el lead', error.message || 'Verifique nuevamente el estado del cliente.');
    } finally {
      q('#create').disabled = false;
      q('#create').textContent = 'Crear lead';
    }
  });

  q('#retry').addEventListener('click', () => q('#verify').click());
  root.querySelectorAll('[data-reset]').forEach((button) => button.addEventListener('click', () => {
    latestResult = null; checkedPhone = ''; q('#phone').value = ''; q('#create').hidden = true;
    q('#open-lead').hidden = true; q('#retry').hidden = true; show('initial'); q('#phone').focus();
  }));

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  show('initial');
})();
