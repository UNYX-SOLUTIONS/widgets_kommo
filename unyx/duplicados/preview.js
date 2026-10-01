/* Vista previa local del widget.
 * NO forma parte del ZIP que se sube a Kommo.
 * Monta un objeto `self` mínimo con la misma interfaz que Kommo
 * (i18n, system, get_settings, render_template, crm_post) y ejecuta
 * script.js sin modificarlo.
 *
 * Configuración:
 *   window.UNYX_PREVIEW_API = 'https://flow.unyxsolutions.com'
 * Si se deja vacío, se simulan las respuestas para recorrer los estados.
 */
(function () {
  'use strict';

  var API = window.UNYX_PREVIEW_API || '';
  var langs = {};

  function loadLang() {
    return fetch('i18n/es.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { langs = data; });
  }

  function mockCheck(phone) {
    var tail = phone.slice(-1);
    if (tail === '2') {
      return {
        ok: true,
        state: 'same_agent',
        phone: phone,
        contactName: 'Carlos Andrés Pérez',
        contactCount: 1,
        closedLeadCount: 3,
        activeLead: { id: 101, name: 'Carlos Pérez', statusName: 'Negociación', responsibleName: 'Usted', leadUrl: '#' }
      };
    }
    if (tail === '3') {
      return {
        ok: true,
        state: 'other_agent',
        phone: phone,
        contactName: 'Ana Lucía Ríos',
        contactCount: 1,
        closedLeadCount: 0,
        activeLead: { id: 102, name: 'Ana Ríos', statusName: 'Seguimiento', responsibleName: 'Diego Zambrano', leadUrl: '#' }
      };
    }
    if (tail === '4') {
      return {
        ok: true,
        state: 'multiple_leads',
        phone: phone,
        contactName: 'Jorge Villalba',
        contactCount: 2,
        closedLeadCount: 1,
        leads: [
          { id: 103, name: 'Jorge Villalba', statusName: 'Cotización', responsibleName: 'Usted', leadUrl: '#' },
          { id: 104, name: 'Jorge V.', statusName: 'Seguimiento', responsibleName: 'Lucía Torres', leadUrl: '#' }
        ]
      };
    }
    if (tail === '5') {
      return {
        ok: true,
        state: 'other_agent',
        phone: phone,
        contactName: 'Cliente en disputa',
        contactCount: 1,
        closedLeadCount: 0,
        activeLead: { id: 105, name: 'Ocupado', statusName: 'Contacto inicial', responsibleName: 'Otra Asesora', leadUrl: '#' }
      };
    }
    return { ok: true, state: 'available', phone: phone, contactName: 'María Fernanda Zambrano', contactCount: 1, closedLeadCount: 2, activeLead: null, leads: [] };
  }

  function crmPost(url, data, callback, type, error) {
    var payload = {};
    Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
    var path = url.replace(API, '');
    var done = function (result) { setTimeout(function () { callback(result); }, 400); };
    var fail = function () { setTimeout(function () { error && error(); }, 400); };

    if (!API) {
      if (path === '/verificar-cliente') return done(mockCheck(String(payload.phone || '')));
      if (path === '/crear-lead') {
        if (String(payload.phone || '').slice(-1) === '5') {
          return done({
            ok: false,
            state: 'other_agent',
            message: 'Este cliente está siendo atendido por otro asesor.',
            contactName: 'Cliente en disputa',
            activeLead: { id: 105, name: 'Ocupado', statusName: 'Contacto inicial', responsibleName: 'Otra Asesora', leadUrl: '#' }
          });
        }
        return done({ ok: true, leadId: 999, leadName: 'María Fernanda Zambrano · ' + payload.phone, contactId: 501, leadUrl: '#' });
      }
      return fail();
    }

    fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (body) { body && body.ok === false ? done(body) : done(body); })
      .catch(fail);
  }

  var host = {
    i18n: function (key) { return langs[key] || {}; },
    system: function () { return { area: 'ccard', subdomain: 'meditecec', user_id: 555, user_name: 'Asesor UNYX' }; },
    get_settings: function () { return { n8n_base: API }; },
    set_settings: function () {},
    render_template: function (data) {
      document.getElementById('preview-root').innerHTML = '<div class="unyx-widget">' + data.body + '</div>';
    },
    crm_post: crmPost,
    params: { cdn_path: '', path: '' },
    widgetsOverlay: function () {},
    add_action: function () {},
    list_selected: function () { return { selected: [] }; }
  };

  window.define = function (deps, factory) {
    host.__factory = factory;
  };

  loadLang().then(function () {
    var script = document.createElement('script');
    script.src = 'script.js';
    script.onload = function () {
      var Widget = host.__factory({});
      var instance = new Widget();
      ['i18n', 'system', 'get_settings', 'set_settings', 'render_template', 'crm_post', 'params', 'widgetsOverlay', 'add_action', 'list_selected'].forEach(function (key) {
        instance[key] = host[key];
      });
      instance.callbacks.render();
      instance.callbacks.init();
      instance.callbacks.bind_actions();
    };
    document.body.appendChild(script);
  });
})();
