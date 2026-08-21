"use strict";
// Shared helpers for the team-sync Worker modules. Uses only Web APIs that exist
// in both Workers and Node ≥ 20 (crypto.getRandomValues, crypto.subtle, Response).

const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U
const INVITE_LENGTH = 10;

const STATUS_FOR_CODE = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  invalid: 400,
  rate_limited: 429,
  unavailable: 502,
};

function uuid() {
  return crypto.randomUUID();
}

function nowIso(deps = {}) {
  const now = deps.now || Date.now;
  return new Date(now()).toISOString();
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function inviteCode() {
  const bytes = new Uint8Array(INVITE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorResponse(code, message, status = STATUS_FOR_CODE[code] || 500, extraHeaders = {}) {
  return json({ error: { code, message } }, status, extraHeaders);
}

module.exports = { uuid, nowIso, sha256Hex, randomToken, inviteCode, json, errorResponse, STATUS_FOR_CODE, INVITE_ALPHABET, INVITE_LENGTH };
