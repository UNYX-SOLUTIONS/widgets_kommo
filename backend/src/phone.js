'use strict';

const E164 = /^\+5939\d{8}$/;

function digits(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\D/g, '');
}

/**
 * Normaliza un celular ecuatoriano a E.164 (+5939XXXXXXXX).
 * Acepta 991234567, 0991234567, 593991234567, +593 99 123 4567.
 */
function normalizeEcMobile(raw) {
  let value = digits(raw);
  if (!value) return null;
  if (value.startsWith('593')) value = value.slice(3);
  if (value.startsWith('0')) value = value.slice(1);
  if (!/^9\d{8}$/.test(value)) return null;
  return '+593' + value;
}

function localNumber(raw) {
  const e164 = normalizeEcMobile(raw);
  return e164 ? e164.slice(4) : null;
}

/** Variantes que se consultan en Kommo: la búsqueda es por texto libre. */
function searchVariants(e164) {
  const local = e164.slice(4);
  return [local, `0${local}`, e164];
}

/** Compara el teléfono de un contacto con el número buscado. */
function matches(e164, contactValue) {
  const target = localNumber(e164);
  const candidate = digits(contactValue);
  if (!candidate || candidate.length < 7 || candidate.length > 15) return false;
  let value = candidate;
  if (value.startsWith('593')) value = value.slice(3);
  if (value.startsWith('0')) value = value.slice(1);
  return value === target;
}

module.exports = { normalizeEcMobile, localNumber, searchVariants, matches, isE164: (value) => E164.test(String(value || '')) };
