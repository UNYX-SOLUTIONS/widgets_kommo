'use strict';

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa backend/.env.example.`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') return fallback;
  return value.trim();
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function load() {
  const nodeEnv = optional('NODE_ENV', 'production');

  if (nodeEnv === 'production') {
    required('KOMMO_CLIENT_ID');
    required('KOMMO_CLIENT_SECRET');
    required('KOMMO_SUBDOMAIN');
    required('SESSION_SECRET');
  }

  return {
    nodeEnv: nodeEnv,
    port: toInt(process.env.PORT, 3000),
    host: optional('HOST', '0.0.0.0'),

    kommoClientId: optional('KOMMO_CLIENT_ID', ''),
    kommoClientSecret: optional('KOMMO_CLIENT_SECRET', ''),
    kommoSubdomain: optional('KOMMO_SUBDOMAIN', ''),
    kommoRedirectUri: optional('KOMMO_REDIRECT_URI', ''),
    kommoApiTimeoutMs: toInt(process.env.KOMMO_API_TIMEOUT_MS, 15000),

    sessionSecret: optional('SESSION_SECRET', 'unyx-dev-session-secret'),
    sessionTtlSeconds: toInt(process.env.SESSION_TTL_SECONDS, 3600),
    checkSecret: optional('CHECK_SECRET', ''),
    checkTtlSeconds: toInt(process.env.CHECK_TTL_SECONDS, 300),

    tokenFile: optional('TOKEN_FILE', '/app/data/tokens.json'),

    corsOrigins: optional('CORS_ORIGINS', 'https://*.kommo.com')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),

    rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 60),
    rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),

    closedStageSortMin: toInt(process.env.CLOSED_STAGE_SORT_MIN, 10000),
    closedStagePattern: optional('CLOSED_STAGE_PATTERN', '(cerrad|closed|ganad|perdid|won|lost)'),

    leadPipelineId: toInt(process.env.LEAD_PIPELINE_ID, 0),
    leadStatusId: toInt(process.env.LEAD_STATUS_ID, 0),
    leadSourceExternalId: optional('LEAD_SOURCE_EXTERNAL_ID', ''),
    leadNameTemplate: optional('LEAD_NAME_TEMPLATE', '{name} · {phone}'),
    contactNameFallback: optional('CONTACT_NAME_FALLBACK', '{phone}')
  };
}

module.exports = { load };
