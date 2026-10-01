'use strict';

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(secret, payload) {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createToken(secret, claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, claims, { exp: now + ttlSeconds });
  const payload = base64url(JSON.stringify(body));
  return `${payload}.${sign(secret, payload)}`;
}

function readToken(secret, token, now) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!safeEqual(parts[1], sign(secret, parts[0]))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
  } catch (error) {
    return null;
  }
  if (!claims || typeof claims.exp !== 'number') return null;
  if (claims.exp <= (now || Math.floor(Date.now() / 1000))) return null;
  return claims;
}

module.exports = { createToken, readToken };
