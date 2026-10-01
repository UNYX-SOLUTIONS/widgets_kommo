/* UNYX · Verificar Cliente
 * Widget privado de Kommo para Meditec.
 *
 * Habla con los webhooks de n8n (flow.unyxsolutions.com) a través del proxy
 * de Kommo (self.crm_post), así que no hay CORS ni credenciales en el
 * navegador: el token de Kommo vive solo en n8n.
 *
 * Contrato y reglas: unyx/n8n/README.md
 */
define(['jquery'], function () {
  var CustomWidget = function () {
    var self = this;

    // Cada cuenta de Kommo tiene su propio par de webhooks:
    //   <base>/verificar-cliente  y  <base>/crear-lead
    // El administrador lo configura al instalar el widget, por ejemplo
    // https://flow.unyxsolutions.com/webhook/unyx-meditec
    var CHECK_PATH = '/verificar-cliente';
    var CREATE_PATH = '/crear-lead';
    var CAPTION_CLASS = 'unyx-caption';

    var ui = {};
    var n8nUrl = '';
    var sharedToken = '';
    var account = '';
    var userId = 0;
    var userName = '';
    var verified = null;
    var boundEl = null;

    function t(key, fallback) {
      return typeof ui[key] === 'string' && ui[key].length ? ui[key] : (fallback || key);
    }

    function esc(value) {
      return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      });
    }

    function card() {
      return document.querySelector('.unyx-card');
    }

    function el(id) {
      return card() ? card().querySelector('#' + id) : null;
    }

    function show(view) {
      var views = card() ? card().querySelectorAll('[data-view]') : [];
      Array.prototype.forEach.call(views, function (node) {
        node.hidden = node.getAttribute('data-view') !== view;
      });
    }

    function markup() {
      return [
        '<section class="unyx-card stack" aria-live="polite">',
        '  <div class="unyx-view stack" data-view="initial">',
        '    <div class="heading">',
        '      <label class="label" for="unyx-phone">' + esc(t('formLabel')) + '</label>',
        '      <p class="hint">' + esc(t('formHint')) + '</p>',
        '    </div>',
        '    <div class="phone">',
        '      <span class="prefix">' + esc(t('prefix')) + '</span>',
        '      <input id="unyx-phone" type="tel" inputmode="numeric" autocomplete="tel-national"',
        '        maxlength="9" placeholder="' + esc(t('phonePlaceholder')) + '">',
        '    </div>',
        '    <p class="error-text" id="unyx-phone-error" hidden></p>',
        '    <button id="unyx-verify" class="button" type="button" data-action="verify">' + esc(t('verify')) + '</button>',
        '  </div>',
        '  <div class="unyx-view" data-view="loading" hidden>',
        '    <div class="status"><h2>' + esc(t('loadingTitle')) + '</h2><p>' + esc(t('loadingText')) + '</p></div>',
        '  </div>',
        '  <div class="unyx-view stack" data-view="result" hidden>',
        '    <div id="unyx-result" class="status"><h2 id="unyx-result-title"></h2><p id="unyx-result-copy"></p><div id="unyx-result-extra" class="details"></div></div>',
        '    <div class="actions">',
        '      <button id="unyx-create" class="button" type="button" data-action="create" hidden>' + esc(t('createLead')) + '</button>',
        '      <button id="unyx-retry" class="button secondary" type="button" data-action="verify" hidden>' + esc(t('retry')) + '</button>',
        '      <button class="button secondary" type="button" data-action="reset">' + esc(t('newQuery')) + '</button>',
        '    </div>',
        '  </div>',
        '</section>'
      ].join('\n');
    }

    function post(path, payload) {
      return new Promise(function (resolve, reject) {
        if (!n8nUrl || !sharedToken) {
          reject(new Error(t('configMissingUrl')));
          return;
        }
        var body = {};
        Object.keys(payload).forEach(function (key) {
          if (payload[key] !== undefined && payload[key] !== null) body[key] = String(payload[key]);
        });
        self.crm_post(n8nUrl + path, body, function (data) {
          if (data && data.ok === false) {
            var error = new Error(data.message || t('genericError'));
            error.payload = data;
            reject(error);
            return;
          }
          resolve(data || {});
        }, 'json', function () {
          reject(new Error(t('genericError')));
        });
      });
    }

    function leadLine(lead) {
      var row = ['<div><b>' + esc(t('labelLead')) + ':</b> ' + esc(lead.name || ('#' + lead.id))];
      if (lead.statusName) row.push(' · ' + esc(lead.statusName));
      if (lead.responsibleName) row.push(' · ' + esc(lead.responsibleName));
      row.push('</div>');
      if (lead.leadUrl) {
        row.push('<div><a class="link" href="' + esc(lead.leadUrl) + '" target="_blank" rel="noopener">' + esc(t('openLeadItem')) + ' ↗</a></div>');
      }
      return row.join('');
    }

    function renderResult(state) {
      var box = el('unyx-result');
      var lines = [];
      var kind = 'info';
      var heading = t('genericError');
      var text = t('genericError');
      var canCreate = false;

      if (state.contactName) {
        lines.push('<div><b>' + esc(t('labelClient')) + ':</b> ' + esc(state.contactName) + '</div>');
      }
      if (state.contactCount > 1) {
        lines.push('<div class="small">' + esc(t('labelContactsFound')) + ': ' + esc(state.contactCount) + '</div>');
      }
      if (state.closedLeadCount > 0) {
        lines.push('<div class="small">' + esc(t('labelClosedHistory')) + ': ' + esc(state.closedLeadCount) + '</div>');
      }

      if (state.state === 'available') {
        kind = 'success';
        heading = t('availableTitle');
        text = state.contactName ? t('availableTextKnown') : t('availableTextUnknown');
        canCreate = true;
      } else if (state.state === 'same_agent') {
        kind = 'info';
        heading = t('sameAgentTitle');
        text = t('sameAgentText');
        if (state.activeLead) lines.push(leadLine(state.activeLead));
      } else if (state.state === 'other_agent') {
        kind = 'blocked';
        heading = t('otherAgentTitle');
        text = t('otherAgentText');
        if (state.activeLead) lines.push(leadLine(state.activeLead));
      } else if (state.state === 'multiple_leads') {
        kind = 'warning';
        heading = t('multipleTitle');
        text = t('multipleText');
        (state.leads || []).forEach(function (lead) { lines.push(leadLine(lead)); });
      } else {
        kind = 'error';
        heading = t('checkErrorTitle');
        text = state.message || t('checkErrorText');
      }

      box.className = 'status ' + kind;
      el('unyx-result-title').textContent = heading;
      el('unyx-result-copy').textContent = text;
      el('unyx-result-extra').innerHTML = lines.join('');
      el('unyx-create').hidden = !canCreate;
      el('unyx-retry').hidden = canCreate;
      show('result');
    }

    function renderFailure(title, text) {
      var box = el('unyx-result');
      box.className = 'status error';
      el('unyx-result-title').textContent = title;
      el('unyx-result-copy').textContent = text;
      el('unyx-result-extra').innerHTML = '';
      el('unyx-create').hidden = true;
      el('unyx-retry').hidden = false;
      show('result');
    }

    function resetForm() {
      verified = null;
      var input = el('unyx-phone');
      input.value = '';
      input.removeAttribute('aria-invalid');
      el('unyx-phone-error').hidden = true;
      el('unyx-create').hidden = true;
      el('unyx-retry').hidden = true;
      show('initial');
      input.focus();
    }

    function setBusy(busy) {
      var button = el('unyx-verify');
      button.disabled = busy;
      button.innerHTML = busy ? '<span class="spinner"></span>' + esc(t('verifying')) : esc(t('verify'));
    }

    function verify() {
      var input = el('unyx-phone');
      var phone = input.value.replace(/\D/g, '');
      var error = el('unyx-phone-error');

      if (!/^9\d{8}$/.test(phone)) {
        input.setAttribute('aria-invalid', 'true');
        error.textContent = t('phoneInvalid');
        error.hidden = false;
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      error.hidden = true;

      if (!n8nUrl || !sharedToken) {
        renderFailure(t('configErrorTitle'), t('configMissingUrl'));
        return;
      }

      if (!account || !userId) {
        renderFailure(t('configErrorTitle'), t('advisorMissing'));
        return;
      }

      show('loading');
      setBusy(true);
      post(CHECK_PATH, {
        phone: '+593' + phone,
        account: account,
        userId: userId,
        userName: userName,
        token: sharedToken
      })
        .then(function (result) {
          verified = result;
          renderResult(result);
        })
        .catch(function (error) {
          renderFailure(t('checkErrorTitle'), (error && error.message) || t('checkErrorText'));
        })
        .then(function () {
          setBusy(false);
        });
    }

    function create() {
      if (!verified || verified.state !== 'available') return;
      var button = el('unyx-create');
      button.disabled = true;
      button.textContent = t('creatingLead');

      post(CREATE_PATH, {
        phone: verified.phone,
        account: account,
        userId: userId,
        userName: userName,
        token: sharedToken
      })
        .then(function (created) {
          verified = null;
          var box = el('unyx-result');
          box.className = 'status success';
          el('unyx-result-title').textContent = t('createdTitle');
          el('unyx-result-copy').textContent = t('createdText');
          var extra = ['<div><b>' + esc(t('labelLead')) + ':</b> ' + esc(created.leadName || t('createdFallbackName')) + '</div>'];
          if (created.leadUrl) {
            extra.push('<div><a class="link" href="' + esc(created.leadUrl) + '" target="_blank" rel="noopener">' + esc(t('openLead')) + ' ↗</a></div>');
          }
          el('unyx-result-extra').innerHTML = extra.join('');
          el('unyx-create').hidden = true;
          el('unyx-retry').hidden = false;
          show('result');
        })
        .catch(function (error) {
          var payload = error && error.payload;
          // n8n revalida antes de crear: si apareció una atención activa,
          // devuelve el estado real para mostrarlo en el mismo card.
          if (payload && payload.state) {
            verified = null;
            renderResult(payload);
            var box = el('unyx-result');
            box.className = 'status error';
            el('unyx-result-title').textContent = t('createErrorTitle');
            el('unyx-result-copy').textContent = payload.message || t('createErrorText');
            return;
          }
          renderFailure(t('createErrorTitle'), (error && error.message) || t('createErrorText'));
        })
        .then(function () {
          button.disabled = false;
          button.textContent = t('createLead');
        });
    }

    this.getContext = function () {
      var system = {};
      try {
        system = self.system() || {};
      } catch (error) {
        system = {};
      }
      var kommoContext = window.kommo_context || {};
      var kommoUser = kommoContext.user || {};
      var subdomain = system.subdomain || kommoContext.subdomain || '';
      var id = parseInt(system.user_id || kommoUser.id || 0, 10);
      var name = system.user_name || system.name || kommoUser.name || kommoUser.full_name || '';
      return {
        account: subdomain,
        userId: isNaN(id) ? 0 : id,
        userName: String(name || '').trim()
      };
    };

    this.callbacks = {
      render: function () {
        ui = self.i18n('ui') || {};
        var settings = self.get_settings() || {};
        var configured = typeof settings.n8n_base === 'string' ? settings.n8n_base.trim() : '';
        n8nUrl = configured.replace(/\/+$/, '');
        sharedToken = typeof settings.unyx_token === 'string' ? settings.unyx_token.trim() : '';

        var context = self.getContext();
        account = context.account;
        userId = context.userId;
        userName = context.userName;

        // No pintar sobre formularios de creación vacíos.
        if (typeof APP !== 'undefined' && APP.data && APP.data.current_card && APP.data.current_card.id === 0) {
          return true;
        }

        var base = (self.params && (self.params.cdn_path || self.params.path)) || '';
        if (base && !document.querySelector('link[data-unyx-style]')) {
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = base.replace(/\/+$/, '') + '/style.css';
          link.setAttribute('data-unyx-style', '1');
          document.head.appendChild(link);
        }

        self.render_template({
          caption: { class_name: CAPTION_CLASS },
          body: markup(),
          render: ''
        });
        return true;
      },

      init: function () {
        var root = card();
        if (root && boundEl !== root) {
          boundEl = root;
          root.addEventListener('input', function (event) {
            var input = event.target;
            if (input.id !== 'unyx-phone') return;
            var digits = input.value.replace(/\D/g, '').slice(0, 9);
            if (digits !== input.value) input.value = digits;
            if (input.getAttribute('aria-invalid') === 'true' && /^9\d{8}$/.test(digits)) {
              input.removeAttribute('aria-invalid');
              el('unyx-phone-error').hidden = true;
            }
          });
          root.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && event.target.id === 'unyx-phone') {
              event.preventDefault();
              verify();
            }
          });
          root.addEventListener('click', function (event) {
            var trigger = event.target.closest ? event.target.closest('[data-action]') : null;
            if (!trigger) return;
            var action = trigger.getAttribute('data-action');
            if (action === 'verify') verify();
            if (action === 'create') create();
            if (action === 'reset') resetForm();
          });
        }
        show('initial');
        return true;
      },

      bind_actions: function () {
        return true;
      },

      destroy: function () {
        boundEl = null;
        verified = null;
        return true;
      },

      onSave: function () {
        return true;
      },

      settings: function () {
        return true;
      }
    };

    return this;
  };

  return CustomWidget;
});
