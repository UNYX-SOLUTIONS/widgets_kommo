'use strict';

const http = require('http');

const config = require('./config').load();
const { KommoClient, KommoError } = require('./kommo');
const { TokenStore } = require('./store');
const { VerificarService, HttpError } = require('./service');
const { createToken, readToken } = require('./security');
const { readBody, sendJson, sendHtml, corsHeaders, RateLimiter } = require('./http');

const store = new TokenStore(config.tokenFile);
const kommo = new KommoClient(config, store);
const service = new VerificarService(config, kommo, store);
const limiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);

function authUrl(account) {
  const state = createToken(config.sessionSecret, { sub: account }, 600);
  const params = new URLSearchParams({
    client_id: config.kommoClientId,
    state,
    mode: 'popup'
  });
  return `https://www.kommo.com/oauth?${params.toString()}`;
}

function requireSession(body) {
  const claims = readToken(config.sessionSecret, body.sessionToken);
  if (!claims) {
    throw new HttpError(401, 'La sesión del widget expiró. Vuelva a autorizar el acceso.', { authRequired: true });
  }
  const userId = parseInt(body.userId, 10);
  if (!Number.isFinite(userId) || claims.user !== userId || claims.sub !== body.account) {
    throw new HttpError(403, 'La sesión no corresponde al asesor actual.');
  }
  return { subdomain: claims.sub, userId };
}

function toInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const routes = {
  'GET /health': async (req, res) => {
    sendJson(res, 200, { ok: true, service: 'unyx-kommo-widget-api', users: store.size() });
  },

  'POST /api/kommo/session': async (req, res, url, body, cors) => {
    const account = String(body.account || '').trim();
    const userId = toInt(body.userId);
    service.assertAccount(account);
    if (userId <= 0) throw new HttpError(400, 'No se pudo identificar al asesor actual.');

    const entry = store.get(account, userId);
    const usable = Boolean(entry && (entry.expiresAt > Date.now() + 30000 || entry.refreshToken));

    if (!usable) {
      sendJson(res, 200, { ok: true, authRequired: true, authUrl: authUrl(account) }, cors);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      authRequired: false,
      sessionToken: createToken(config.sessionSecret, { sub: account, user: userId }, config.sessionTtlSeconds)
    }, cors);
  },

  'POST /api/kommo/client-check': async (req, res, url, body, cors) => {
    const ctx = requireSession(body);
    sendJson(res, 200, await service.check(ctx.subdomain, ctx.userId, body.phone), cors);
  },

  'POST /api/kommo/leads': async (req, res, url, body, cors) => {
    const ctx = requireSession(body);
    sendJson(res, 200, await service.createLead(ctx.subdomain, ctx.userId, body.phone, body.checkId), cors);
  },

  'GET /api/kommo/oauth/callback': async (req, res, url) => {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const referer = url.searchParams.get('referer') || url.searchParams.get('referrer') || '';
    const claims = readToken(config.sessionSecret, state);

    if (!code || !claims) {
      sendHtml(res, 400, oauthPage('No se pudo validar la autorización.', false));
      return;
    }

    const subdomain = String(referer).split('.')[0].toLowerCase();
    if (!subdomain || !/^[a-z0-9-]+$/i.test(subdomain)) {
      sendHtml(res, 400, oauthPage('No se pudo identificar la cuenta de Kommo.', false));
      return;
    }
    if (config.kommoSubdomain && subdomain !== config.kommoSubdomain.toLowerCase()) {
      sendHtml(res, 403, oauthPage('Esa cuenta no está habilitada para este servicio.', false));
      return;
    }

    try {
      const entry = await kommo.exchangeAuthorizationCode(subdomain, code);
      sendHtml(res, 200, oauthPage(`Acceso autorizado para ${entry.userId}. Ya puede cerrar esta ventana.`, true));
    } catch (error) {
      sendHtml(res, 400, oauthPage('Kommo no autorizó el acceso.', false));
    }
  }
};

function oauthPage(message, ok) {
  const status = ok ? 'ok' : 'error';
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    `<title>UNYX · ${status}</title>`,
    '<style>body{font-family:Arial,sans-serif;background:#f8fafc;color:#1e293b;display:grid;place-items:center;height:100vh;margin:0}',
    'div{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;max-width:320px;text-align:center}',
    'strong{display:block;font-size:14px;margin-bottom:6px}</style></head><body><div>',
    `<strong>UNYX · Verificar Cliente</strong><p>${message}</p>`,
    '</div><script>setTimeout(function(){window.close();},1500);</script>',
    '</body></html>'
  ].join('');
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin, config.corsOrigins);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (origin && !cors['access-control-allow-origin']) {
    sendJson(res, 403, { ok: false, message: 'Origen no permitido.' });
    return;
  }

  if (!limiter.check(req.socket.remoteAddress || 'unknown')) {
    sendJson(res, 429, { ok: false, message: 'Demasiadas solicitudes. Espere un momento.' }, cors);
    return;
  }

  const key = `${req.method} ${url.pathname}`;
  const route = routes[key];

  if (!route) {
    sendJson(res, 404, { ok: false, message: 'Recurso no encontrado.' }, cors);
    return;
  }

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    await route(req, res, url, body, cors);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, Object.assign({ ok: false, message: error.message }, error.payload || {}), cors);
      return;
    }
    if (error instanceof KommoError) {
      console.error('[kommo]', error.status, error.message, error.detail || '');
      sendJson(res, error.status, { ok: false, message: error.message }, cors);
      return;
    }
    console.error('[error]', error && error.stack ? error.stack : error);
    sendJson(res, 500, { ok: false, message: 'Error interno del servicio UNYX.' }, cors);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`UNYX Kommo Widget API escuchando en ${config.host}:${config.port}`);
  console.log(`Cuenta Kommo: ${config.kommoSubdomain || '(sin fijar)'} · usuarios autorizados: ${store.size()}`);
});
