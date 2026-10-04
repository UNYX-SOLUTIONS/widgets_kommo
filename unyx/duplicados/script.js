/* UNYX · Verificar Cliente

 * Widget privado de Kommo.

 *

 * Reglas de integración con Kommo (importantes):

 *  - El script corre en la MISMA página que Kommo: nada de tocar document.body,

 *    document.documentElement ni window, y ningún selector global.

 *  - El ciclo de vida son los callbacks render/init/bind_actions. `render` debe

 *    devolver true para que Kommo llame a init y bind_actions, y false en las

 *    fichas de creación (leads/add, contacts/add), donde no hay que pintarse.

 *  - La hoja de estilos se inserta DENTRO del markup del widget (patrón de la

 *    documentación oficial), no en document.head: así vive y muere con el widget.

 *  - Todo el CSS está encapsulado bajo .unyx-widget (ver style.css).

 *  - Todos los nodos del DOM se buscan desde la raíz de ESTA instancia, que

 *    lleva un id único. No se usan ids ni selectores globales.

 *  - Las llamadas al backend van por self.crm_post (proxy de Kommo): sin CORS.

 *

 * Contrato y reglas: unyx/n8n/README.md

 */

define(["jquery"], function () {
  var CustomWidget = function () {
    var self = this;

    // Cada cuenta tiene su par de webhooks en n8n:

    //   <base>/verificar-cliente  y  <base>/crear-lead

    var CHECK_PATH = "/verificar-cliente";

    var CREATE_PATH = "/crear-lead";

    var instanceId = "unyx-root-" + Math.random().toString(36).slice(2, 9);

    var ui = {};

    var n8nUrl = "";

    var sharedToken = "";

    var account = "";

    var userId = 0;

    var userName = "";

    var verified = null;

    var boundEl = null;

    // Códigos de país del selector. El primero sale seleccionado.
    // Para agregar uno: añade ["ISO", "código"] a esta lista.
    var PAISES = [
      ["EC", "593"],
      ["CO", "57"],
      ["PE", "51"],
      ["CL", "56"],
      ["AR", "54"],
      ["MX", "52"],
      ["US", "1"],
      ["ES", "34"],
      ["PA", "507"],
      ["VE", "58"],
      ["BR", "55"],
      ["BO", "591"],
      ["UY", "598"],
      ["PY", "595"],
      ["CR", "506"],
      ["GT", "502"],
      ["SV", "503"],
      ["HN", "504"],
      ["NI", "505"],
      ["CN", "86"],
      ["IT", "39"],
      ["FR", "33"],
      ["DE", "49"],
      ["GB", "44"],
    ];

    var MAX_DIGITOS = 12;

    function opcionesPais() {
      return PAISES.map(function (pais) {
        return (
          '<option value="' +
          pais[1] +
          '">' +
          pais[0] +
          " +" +
          pais[1] +
          "</option>"
        );
      }).join("");
    }

    function paisSeleccionado() {
      var select = el("country");

      return select && select.value ? String(select.value) : "593";
    }

    function maxDigitos(pais) {
      return pais === "593" ? 9 : MAX_DIGITOS;
    }

    // Ecuador conserva su regla de celular (9 dígitos empezando por 9);
    // el resto acepta de 6 a 12 dígitos.
    function numeroValido(pais, digitos) {
      if (pais === "593") return /^9\d{8}$/.test(digitos);

      return /^\d{6,12}$/.test(digitos);
    }

    function t(key, fallback) {
      return typeof ui[key] === "string" && ui[key].length
        ? ui[key]
        : fallback || key;
    }

    function esc(value) {
      return String(value === undefined || value === null ? "" : value).replace(
        /[&<>"']/g,
        function (char) {
          return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[char];
        },
      );
    }

    // Raíz de esta instancia. Si hay dos widgets en la página, cada uno

    // encuentra el suyo y no se pisan los escuchadores.

    function root() {
      return document.getElementById(instanceId);
    }

    function el(name) {
      var host = root();

      return host ? host.querySelector('[data-unyx="' + name + '"]') : null;
    }

    function show(view) {
      var host = root();

      if (!host) return;

      Array.prototype.forEach.call(
        host.querySelectorAll("[data-unyx-view]"),
        function (node) {
          node.hidden = node.getAttribute("data-unyx-view") !== view;
        },
      );
    }

    // URL de la hoja de estilos, según la documentación del widget.

    function styleHref() {
      var base =
        (self.params && (self.params.cdn_path || self.params.path)) || "";

      if (base) return base.replace(/\/+$/, "") + "/style.css";

      var code = (self.get_settings() || {}).widget_code;

      if (code) return "/widgets/" + encodeURIComponent(code) + "/style.css";

      return "style.css";
    }

    function markup() {
      var statusClass = "unyx-status";

      return [
        '<div class="unyx-widget" id="' + instanceId + '">',

        '  <link rel="stylesheet" data-unyx="style" href="' +
          esc(styleHref()) +
          '">',

        '  <section class="unyx-card unyx-stack" aria-live="polite">',

        '    <div class="unyx-view unyx-stack" data-unyx-view="initial">',

        '      <div class="unyx-heading">',

        '        <label class="unyx-label" for="' +
          instanceId +
          '-phone">' +
          esc(t("formLabel")) +
          "</label>",

        '        <p class="unyx-hint">' + esc(t("formHint")) + "</p>",

        "      </div>",

        '      <div class="unyx-phone">',

        '        <select class="unyx-prefix" data-unyx="country" aria-label="' +
          esc(t("countryLabel")) +
          '">' +
          opcionesPais() +
          "</select>",

        '        <input id="' +
          instanceId +
          '-phone" data-unyx="phone" type="tel" inputmode="numeric"',

        '          autocomplete="tel-national" maxlength="9" placeholder="' +
          esc(t("phonePlaceholder")) +
          '">',

        "      </div>",

        '      <p class="unyx-error-text" data-unyx="phone-error" hidden></p>',

        '      <button class="unyx-button" data-unyx="verify" type="button" data-unyx-action="verify">' +
          esc(t("verify")) +
          "</button>",

        "    </div>",

        '    <div class="unyx-view" data-unyx-view="loading" hidden>',

        '      <div class="' +
          statusClass +
          '"><h2>' +
          esc(t("loadingTitle")) +
          "</h2><p>" +
          esc(t("loadingText")) +
          "</p></div>",

        "    </div>",

        '    <div class="unyx-view unyx-stack" data-unyx-view="result" hidden>',

        '      <div data-unyx="result" class="' + statusClass + '">',

        '        <h2 data-unyx="result-title"></h2>',

        '        <p data-unyx="result-copy"></p>',

        '        <div data-unyx="result-extra" class="unyx-details"></div>',

        "      </div>",

        '      <div class="unyx-actions">',

        '        <button class="unyx-button" data-unyx="create" type="button" data-unyx-action="create" hidden>' +
          esc(t("createLead")) +
          "</button>",

        '        <button class="unyx-button unyx-secondary" data-unyx="retry" type="button" data-unyx-action="verify" hidden>' +
          esc(t("retry")) +
          "</button>",

        '        <button class="unyx-button unyx-secondary" type="button" data-unyx-action="reset">' +
          esc(t("newQuery")) +
          "</button>",

        "      </div>",

        "    </div>",

        "  </section>",

        "</div>",
      ].join("\n");
    }

    function post(path, payload) {
      return new Promise(function (resolve, reject) {
        if (!n8nUrl || !sharedToken) {
          reject(new Error(t("configMissingUrl")));

          return;
        }

        var body = {};

        Object.keys(payload).forEach(function (key) {
          if (payload[key] !== undefined && payload[key] !== null)
            body[key] = String(payload[key]);
        });

        self.crm_post(
          n8nUrl + path,
          body,
          function (data) {
            if (data && data.ok === false) {
              var error = new Error(data.message || t("genericError"));

              error.payload = data;

              reject(error);

              return;
            }

            resolve(data || {});
          },
          "json",
          function () {
            reject(new Error(t("genericError")));
          },
        );
      });
    }

    function leadLine(lead) {
      var row = [
        "<div><b>" +
          esc(t("labelLead")) +
          ":</b> " +
          esc(lead.name || "#" + lead.id),
      ];

      if (lead.statusName) row.push(" · " + esc(lead.statusName));

      if (lead.responsibleName) row.push(" · " + esc(lead.responsibleName));

      row.push("</div>");

      if (lead.leadUrl) {
        row.push(
          '<div><a class="unyx-link" href="' +
            esc(lead.leadUrl) +
            '" target="_blank" rel="noopener">' +
            esc(t("openLeadItem")) +
            " ↗</a></div>",
        );
      }

      return row.join("");
    }

    function setStatus(kind, title, text, lines) {
      var box = el("result");

      if (!box) return;

      box.className = "unyx-status unyx-status--" + kind;

      el("result-title").textContent = title;

      el("result-copy").textContent = text;

      el("result-extra").innerHTML = (lines || []).join("");
    }

    function renderResult(state) {
      var lines = [];

      var kind = "info";

      var heading = t("genericError");

      var text = t("genericError");

      var canCreate = false;

      if (state.contactName) {
        lines.push(
          "<div><b>" +
            esc(t("labelClient")) +
            ":</b> " +
            esc(state.contactName) +
            "</div>",
        );
      }

      if (state.contactCount > 1) {
        lines.push(
          '<div class="unyx-small">' +
            esc(t("labelContactsFound")) +
            ": " +
            esc(state.contactCount) +
            "</div>",
        );
      }

      if (state.closedLeadCount > 0) {
        lines.push(
          '<div class="unyx-small">' +
            esc(t("labelClosedHistory")) +
            ": " +
            esc(state.closedLeadCount) +
            "</div>",
        );
      }

      if (state.state === "available") {
        kind = "success";

        heading = t("availableTitle");

        text = state.contactName
          ? t("availableTextKnown")
          : t("availableTextUnknown");

        canCreate = true;
      } else if (state.state === "same_agent") {
        kind = "info";

        heading = t("sameAgentTitle");

        text = t("sameAgentText");

        if (state.activeLead) lines.push(leadLine(state.activeLead));
      } else if (state.state === "other_agent") {
        kind = "blocked";

        heading = t("otherAgentTitle");

        text = t("otherAgentText");

        if (state.activeLead) lines.push(leadLine(state.activeLead));
      } else if (state.state === "multiple_leads") {
        kind = "warning";

        heading = t("multipleTitle");

        text = t("multipleText");

        (state.leads || []).forEach(function (lead) {
          lines.push(leadLine(lead));
        });
      } else {
        kind = "error";

        heading = t("checkErrorTitle");

        text = state.message || t("checkErrorText");
      }

      setStatus(kind, heading, text, lines);

      el("create").hidden = !canCreate;

      el("retry").hidden = canCreate;

      show("result");
    }

    function renderFailure(title, text) {
      setStatus("error", title, text, []);

      el("create").hidden = true;

      el("retry").hidden = false;

      show("result");
    }

    function resetForm() {
      verified = null;

      var input = el("phone");

      input.value = "";

      input.removeAttribute("aria-invalid");

      el("phone-error").hidden = true;

      el("create").hidden = true;

      el("retry").hidden = true;

      show("initial");

      input.focus();
    }

    function setBusy(busy) {
      var button = el("verify");

      if (!button) return;

      button.disabled = busy;

      button.innerHTML = busy
        ? '<span class="unyx-spinner"></span>' + esc(t("verifying"))
        : esc(t("verify"));
    }

    function verify() {
      var input = el("phone");

      var phone = input.value.replace(/\D/g, "");

      var error = el("phone-error");

      var pais = paisSeleccionado();

      if (!numeroValido(pais, phone)) {
        input.setAttribute("aria-invalid", "true");

        error.textContent = t("phoneInvalid");

        error.hidden = false;

        input.focus();

        return;
      }

      input.removeAttribute("aria-invalid");

      error.hidden = true;

      if (!n8nUrl || !sharedToken) {
        renderFailure(t("configErrorTitle"), t("configMissingUrl"));

        return;
      }

      // Último reintento: si init() no pudo leer el asesor, se prueba otra vez

      // justo antes de gastar una llamada al backend.

      if (!userId || !account) {
        refreshContext("verify");
      }

      if (!userId || userId <= 0) {
        renderFailure(t("configErrorTitle"), t("advisorMissing"));

        return;
      }

      show("loading");

      setBusy(true);

      post(CHECK_PATH, {
        phone: "+" + pais + phone,

        country: pais,

        account: account,

        userId: userId,

        userName: userName,

        token: sharedToken,
      })
        .then(function (result) {
          verified = result;

          renderResult(result);
        })

        .catch(function (error) {
          renderFailure(
            t("checkErrorTitle"),
            (error && error.message) || t("checkErrorText"),
          );
        })

        .then(function () {
          setBusy(false);
        });
    }

    function create() {
      if (!verified || verified.state !== "available") return;

      var button = el("create");

      button.disabled = true;

      button.textContent = t("creatingLead");

      post(CREATE_PATH, {
        phone: verified.phone,

        country: paisSeleccionado(),

        account: account,

        userId: userId,

        userName: userName,

        token: sharedToken,
      })
        .then(function (created) {
          verified = null;

          var lines = [
            "<div><b>" +
              esc(t("labelLead")) +
              ":</b> " +
              esc(created.leadName || t("createdFallbackName")) +
              "</div>",
          ];

          if (created.leadUrl) {
            lines.push(
              '<div><a class="unyx-link" href="' +
                esc(created.leadUrl) +
                '" target="_blank" rel="noopener">' +
                esc(t("openLead")) +
                " ↗</a></div>",
            );
          }

          setStatus("success", t("createdTitle"), t("createdText"), lines);

          el("create").hidden = true;

          el("retry").hidden = false;

          show("result");
        })

        .catch(function (error) {
          var payload = error && error.payload;

          // n8n revalida antes de crear: si apareció una atención activa,

          // devuelve el estado real para mostrarlo en el mismo card.

          if (payload && payload.state) {
            verified = null;

            renderResult(payload);

            setStatus(
              "error",
              t("createErrorTitle"),
              payload.message || t("createErrorText"),
              [],
            );

            return;
          }

          renderFailure(
            t("createErrorTitle"),
            (error && error.message) || t("createErrorText"),
          );
        })

        .then(function () {
          button.disabled = false;

          button.textContent = t("createLead");
        });
    }

    // Lee el contexto del widget. self.system() es la fuente documentada; si no

    // devuelve al asesor se completa con APP.data, y el subdominio cae al

    // hostname cuando la página es *.kommo.com.

    //

    // Se llama desde init() y se reintenta justo antes de usar el dato:

    // self.system() no está garantizado en todos los momentos del ciclo de

    // vida, y render() corre antes que init().

    this.getContext = function () {
      var widgetSelf = self;

      var system = {};

      try {
        if (widgetSelf && typeof widgetSelf.system === "function") {
          system = widgetSelf.system() || {};
        }
      } catch (error) {
        system = {};
      }

      var app = typeof APP !== "undefined" && APP && APP.data ? APP.data : {};

      var appUser = app.current_user || app.user || {};

      // Constantes documentadas del WEB SDK (Environment variables).
      // APP.constant('user') devuelve el usuario actual, con id y name.
      function constante(clave) {
        try {
          return typeof APP !== "undefined" &&
            APP &&
            typeof APP.constant === "function"
            ? APP.constant(clave) || {}
            : {};
        } catch (error) {
          return {};
        }
      }

      var usuarioConstante = constante("user");
      var cuentaConstante = constante("account");

      function primero() {
        for (var i = 0; i < arguments.length; i++) {
          var valor = arguments[i];

          if (
            valor !== undefined &&
            valor !== null &&
            String(valor).trim() !== ""
          )
            return valor;
        }

        return "";
      }

      var id = parseInt(
        primero(
          system.user_id,
          system.userId,
          usuarioConstante.id,
          app.current_user_id,
          app.user_id,
          appUser.id,
          0,
        ),
        10,
      );
      if (!Number.isFinite(id) || id <= 0) id = 0;

      var subdominio = String(
        primero(
          system.subdomain,
          cuentaConstante.subdomain,
          app.subdomain,
          "",
        ),
      ).toLowerCase();

      if (
        !subdominio &&
        typeof location !== "undefined" &&
        /\.kommo\.com$/i.test(location.hostname)
      ) {
        subdominio = String(location.hostname).split(".")[0].toLowerCase();
      }

      return {
        account: subdominio,

        userId: id,

        userName: String(
          primero(
            system.user_name,
            system.name,
            usuarioConstante.name,
            app.user_name,
            appUser.name,
            "",
          ),
        ).trim(),
      };
    };

    // Copia al estado del widget lo que getContext() haya podido resolver. No

    // pisa con vacío un valor ya bueno, así un reintento posterior puede

    // completar lo que faltaba.

    function refreshContext(origen) {
      var context = self.getContext();

      if (context.account) account = context.account;

      if (context.userId > 0) userId = context.userId;

      if (context.userName) userName = context.userName;

      if (origen === "init") {
        // Diagnóstico: no imprime tokens ni credenciales.

        console.log("[UNYX] Contexto detectado:", {
          account: account,
          userId: userId,
          userName: userName,
        });

        // Si no se pudo leer el asesor, se vuelca qué devuelve cada fuente
        // para diagnosticarlo desde la consola. No imprime tokens.
        if (!userId) {
          var intentar = function (fn) {
            try {
              return fn();
            } catch (error) {
              return "error: " + error.message;
            }
          };

          console.warn("[UNYX] Sin asesor. Diagnóstico:", {
            "self.system()": intentar(function () {
              return self.system();
            }),
            "APP.constant('user')": intentar(function () {
              return APP.constant("user");
            }),
            "APP.getWidgetsArea()": intentar(function () {
              return APP.getWidgetsArea();
            }),
            "APP.data (claves)": intentar(function () {
              return Object.keys(APP.data || {});
            }),
          });
        }
      }

      return context;
    }

    this.callbacks = {
      render: function () {
        ui = self.i18n("ui") || {};

        var settings = self.get_settings() || {};

        var configured =
          typeof settings.n8n_base === "string" ? settings.n8n_base.trim() : "";

        n8nUrl = configured.replace(/\/+$/, "");

        sharedToken =
          typeof settings.unyx_token === "string"
            ? settings.unyx_token.trim()
            : "";

        // El contexto (asesor y cuenta) NO se lee aquí: render() corre antes

        // que init() y self.system() no está garantizado todavía. Se lee en

        // init() y, si hiciera falta, otra vez al verificar.

        // En las fichas de creación (leads/add, contacts/add) no hay que

        // pintarse: la documentación pide devolver false para que Kommo no

        // llame a init ni a bind_actions.

        if (
          typeof APP !== "undefined" &&
          APP.data &&
          APP.data.current_card &&
          APP.data.current_card.id === 0
        ) {
          return false;
        }

        self.render_template({
          caption: { class_name: "unyx-caption" },

          body: markup(),

          render: "",
        });

        return true;
      },

      init: function () {
        // Aquí self.system() ya está disponible: se lee el asesor y la cuenta.

        refreshContext("init");

        // El href se resuelve otra vez aquí: si self.params no estaba listo

        // durante render(), el <link> del markup quedó apuntando a un sitio

        // equivocado y sin CSS el widget se ve con los colores del tema.

        var link = el("style");

        if (link) {
          var href = styleHref();

          if (href && link.getAttribute("href") !== href)
            link.setAttribute("href", href);
        }

        var host = root();

        if (host && boundEl !== host) {
          boundEl = host;

          host.addEventListener("input", function (event) {
            var input = event.target;

            if (!input || input.getAttribute("data-unyx") !== "phone") return;

            var paisActual = paisSeleccionado();

            var digits = input.value
              .replace(/\D/g, "")
              .slice(0, maxDigitos(paisActual));

            if (digits !== input.value) input.value = digits;

            if (
              input.getAttribute("aria-invalid") === "true" &&
              numeroValido(paisActual, digits)
            ) {
              input.removeAttribute("aria-invalid");

              el("phone-error").hidden = true;
            }
          });

          // Al cambiar de país se ajusta el máximo de dígitos y se limpia el
          // error, para no arrastrar la validación del país anterior.
          host.addEventListener("change", function (event) {
            var select = event.target;

            if (!select || select.getAttribute("data-unyx") !== "country") return;

            var input = el("phone");

            var paisActual = paisSeleccionado();

            var max = maxDigitos(paisActual);

            input.maxLength = max;

            input.value = input.value.replace(/\D/g, "").slice(0, max);

            input.removeAttribute("aria-invalid");

            var error = el("phone-error");

            if (error) error.hidden = true;
          });

          host.addEventListener("keydown", function (event) {
            var target = event.target;

            if (
              event.key === "Enter" &&
              target &&
              target.getAttribute("data-unyx") === "phone"
            ) {
              event.preventDefault();

              verify();
            }
          });

          host.addEventListener("click", function (event) {
            var trigger = event.target.closest
              ? event.target.closest("[data-unyx-action]")
              : null;

            if (!trigger) return;

            var action = trigger.getAttribute("data-unyx-action");

            if (action === "verify") verify();

            if (action === "create") create();

            if (action === "reset") resetForm();
          });
        }

        show("initial");

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
      },
    };

    return this;
  };

  return CustomWidget;
});
