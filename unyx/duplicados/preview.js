/* Vista previa local del widget.
 * NO forma parte del ZIP que se sube a Kommo.
 * Monta un objeto `self` mínimo con la misma interfaz que Kommo
 * (i18n, system, get_settings, render_template, crm_post) y ejecuta
 * script.js sin modificarlo.
 *
 * Configuración:
 *   window.UNYX_PREVIEW_API = 'https://tu-backend.unyxsolutions.com'
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

  function mockState(phone) {
    var tail = phone.slice(-1);
    if (tail === '1') {
      return {
        state: 'available',
        contactName: 'María Fernanda Zambrano',
        phone: phone,
        closedLeadCount: 2,
        checkId: 'preview-check'
      };
    }
    if (tail === '2') {
      return {
        state: 'same_agent',
        contactName: 'Carlos Andrés Pérez',
        phone: phone,
        activeLead: { id: 101, name: 'Carlos Pérez', statusName: 'Negociación', responsibleName: 'Usted', leadUrl: '#' }
      };
    }
    if (tail === '3') {
      return {
        state: 'other_agent',
        contactName: 'Ana Lucía Ríos',
        phone: phone,
        activeLead: { id: 102, name: 'Ana Ríos', statusName: 'Seguimiento', responsibleName: 'Diego Zambrano', leadUrl: '#' }
      };
    }
    if (tail === '4') {
      return {
        state: 'multiple_leads',
        contactName: 'Jorge Villalba',
        phone: phone,
        contactCount: 2,
        leads: [
          { id: 103, name: 'Jorge Villalba', statusName: 'Cotización', responsibleName: 'Usted', leadUrl: '#' },
          { id: 104, name: 'Jorge V.', statusName: 'Seguimiento', responsibleName: 'Lucía Torres', leadUrl: '#' }
        ]
      };
    }
    return { state: 'available', phone: phone, checkId: 'preview-check' };
  }

  function crmPost(url, data, callback, type, error) {
    var payload = {};
    Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
    var path = url.replace(API, '');
    var done = function (result) { setTimeout(function () { callback(result); }, 350); };
    var fail = function () { setTimeout(function () { error && error(); }, 350); };

    if (!API) {
      if (path === '/api/kommo/session') return done({ sessionToken: 'preview', authRequired: false });
      if (path === '/api/kommo/client-check') return done(mockState(String(payload.phone || '')));
      if (path === '/api/kommo/leads') return done({ leadName: 'Lead de prueba', leadUrl: '#' });
      return fail();
    }

    fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (r) { r.ok ? done(r.body) : fail(); })
      .catch(fail);
  }

  var host = {
    i18n: function (key) { return langs[key] || {}; },
    system: function () { return { area: 'lcard', subdomain: 'preview', user_id: 1 }; },
    get_settings: function () { return { api_url: API }; },
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
