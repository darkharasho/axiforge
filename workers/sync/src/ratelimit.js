"use strict";
// Fixed-window counter in KV. Key = `${key}:${windowStart}`; value = count; TTL =
// window. KV is eventually consistent, so this is a soft limit — fine for
// abuse-dampening, not for billing.

async function checkRateLimit(kv, key, limit, windowSeconds, deps = {}, cost = 1) {
  if (!kv) return { ok: true, retryAfterSeconds: 0 };
  const now = (deps.now || Date.now)();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = `rl:${key}:${windowStart}`;
  const count = Number((await kv.get(bucket)) || 0);
  if (count + cost > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  }
  await kv.put(bucket, String(count + cost), { expirationTtl: Math.max(60, windowSeconds * 2) });
  return { ok: true, retryAfterSeconds: 0 };
}

module.exports = { checkRateLimit };
