'use strict';

const MAX_BODY_BYTES = 16384;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const contentType = String(req.headers['content-type'] || '');
      if (!raw) {
        resolve({});
        return;
      }
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error('JSON inválido'));
        }
        return;
      }
      resolve(Object.fromEntries(new URLSearchParams(raw).entries()));
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, headers || {}));
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(html);
}

function originAllowed(origin, patterns) {
  if (!origin) return true;
  return patterns.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return origin.endsWith(suffix);
    }
    return origin === pattern;
  });
}

function corsHeaders(origin, patterns) {
  if (!origin || !originAllowed(origin, patterns)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin'
  };
}

class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 5000) this.sweep(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  sweep(now) {
    this.hits.forEach((entry, key) => {
      if (now > entry.resetAt) this.hits.delete(key);
    });
  }
}

module.exports = { readBody, sendJson, sendHtml, corsHeaders, originAllowed, RateLimiter };
