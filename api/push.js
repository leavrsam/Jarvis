// Push notifications (Web Push) to the devices where you've turned them on: phones, laptops, the
// kiosk. n8n (or anything else) posts to /api/notify with the shared secret; this sends it to
// every subscribed device. Works like ntfy, but straight into Jarvis.
//
// From the HUD (logged in, same origin):
//   GET  /api/push                                       -> { configured, missing, publicKey, devices }
//   POST /api/push { action: 'subscribe', subscription, name }
//   POST /api/push { action: 'unsubscribe', endpoint }
//   POST /api/push { action: 'test' }
// From n8n / scripts (no login; secret instead). /api/notify is rewritten to here:
//   POST /api/notify   X-Jarvis-Key: <secret>   (or Authorization: Bearer <secret>)
//     JSON: { title, message | body, url | click, priority 1-5, tags, tag, speak }
//     ntfy-style also works: a plain-text body with Title / Priority / Tags / Click headers.
//   -> { sent, failed, removed }
//
// Setup (Vercel env): VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys),
// optional VAPID_SUBJECT (mailto: or https: URL); a Redis store for the device list
// (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or Vercel KV's KV_REST_API_URL +
// KV_REST_API_TOKEN); the secret is JARVIS_NOTIFY_SECRET, else JARVIS_WEBHOOK_SECRET.
import { createHash, timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { clientIp, createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const hudLimiter = createRateLimiter(30);
const notifyLimiter = createRateLimiter(60);
const notifyFailures = createRateLimiter(10); // wrong secrets
const STORE_KEY = 'jarvis:push:subscriptions';
const MAX_DEVICES = 20;
const MAX_BODY = 16_000;

// ---------------------------------------------------------------------------- helpers

function sendJson(res, status, obj, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

async function readRaw(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    if (typeof req.body === 'string') return req.body;
    return JSON.stringify(req.body); // already parsed by the platform
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
  }
  return raw;
}

const header = (req, ...names) => {
  for (const n of names) {
    const v = req.headers[n.toLowerCase()];
    if (v) return String(Array.isArray(v) ? v[0] : v).trim();
  }
  return '';
};

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function vapid() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  const subject = (process.env.VAPID_SUBJECT || '').trim() || (host ? `https://${host}` : 'mailto:jarvis@example.com');
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

function notifySecret() {
  return (process.env.JARVIS_NOTIFY_SECRET || process.env.JARVIS_WEBHOOK_SECRET || '').trim();
}

function secretMatches(given) {
  const expected = notifySecret();
  if (!expected || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------- device store (Redis REST)

/**
 * Upstash Redis REST credentials. Vercel's Upstash integration sets KV_REST_API_URL / _TOKEN or
 * UPSTASH_REDIS_REST_URL / _TOKEN, optionally with a custom prefix ("STORAGE_KV_REST_API_URL"),
 * so any prefix is accepted. (Not the read-only token: we write.)
 */
export function storeConfig(env = process.env) {
  for (const [urlSuffix, tokenSuffix] of [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ]) {
    const urlKeys = Object.keys(env).filter((k) => k.endsWith(urlSuffix) && env[k]).sort((a, b) => a.length - b.length);
    for (const urlKey of urlKeys) {
      const prefix = urlKey.slice(0, urlKey.length - urlSuffix.length);
      const url = String(env[urlKey]).trim().replace(/\/+$/, '');
      const token = String(env[prefix + tokenSuffix] || '').trim();
      if (/^https:\/\//.test(url) && token) return { url, token };
    }
  }
  return null;
}

async function redis(command) {
  const cfg = storeConfig();
  if (!cfg) throw Object.assign(new Error('no store'), { code: 'store_not_configured' });
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw Object.assign(new Error(data.error || `store HTTP ${r.status}`), { code: 'store_error' });
  return data.result;
}

const idOf = (endpoint) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

async function listDevices() {
  const flat = (await redis(['HGETALL', STORE_KEY])) || [];
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const d = JSON.parse(flat[i + 1]);
      if (d?.subscription?.endpoint) out.push({ id: flat[i], ...d });
    } catch {}
  }
  return out;
}

const removeDevice = (id) => redis(['HDEL', STORE_KEY, id]);

/** A browser PushSubscription as JSON: { endpoint, keys: { p256dh, auth } } */
function validSubscription(s) {
  try {
    const u = new URL(s?.endpoint);
    return (
      u.protocol === 'https:' &&
      typeof s.keys?.p256dh === 'string' &&
      typeof s.keys?.auth === 'string' &&
      s.keys.p256dh.length < 200 &&
      s.keys.auth.length < 100 &&
      s.endpoint.length < 1000
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------- sending

const PRIORITY_WORDS = { min: 1, low: 2, default: 3, high: 4, urgent: 5, max: 5 };

function parsePriority(v) {
  if (typeof v === 'number') return Math.min(5, Math.max(1, Math.round(v)));
  const s = String(v || '').trim().toLowerCase();
  if (/^[1-5]$/.test(s)) return Number(s);
  return PRIORITY_WORDS[s] || 3;
}

/** n8n's JSON, or an ntfy-style plain-text body with headers → one notification */
export function parseNotification(raw, contentType, getHeader) {
  let d = {};
  const isJson = /json/i.test(contentType) || /^\s*\{/.test(raw);
  if (isJson) {
    try {
      d = JSON.parse(raw || '{}');
    } catch {
      return null;
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  } else {
    d = { message: raw };
  }
  const tagsRaw = d.tags ?? getHeader('Tags', 'X-Tags', 'Ta');
  const tags = (Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw || '').split(','))
    .map((t) => clean(String(t), 30))
    .filter(Boolean)
    .slice(0, 5);
  const title = clean(d.title ?? getHeader('Title', 'X-Title', 'T'), 120) || 'Jarvis';
  const body = clean(d.message ?? d.body ?? d.text ?? '', 1000);
  let url = clean(d.url ?? d.click ?? getHeader('Click', 'X-Click'), 500);
  if (url && !/^(https?:\/\/|\/)/i.test(url)) url = '';
  const speakRaw = d.speak ?? getHeader('X-Speak');
  const speak = speakRaw === true || /^(1|true|yes)$/i.test(String(speakRaw || ''));
  const tag = clean(d.tag ?? '', 64);
  if (!body && !d.title) return null;
  return { title, body, url: url || '/', priority: parsePriority(d.priority ?? getHeader('Priority', 'X-Priority', 'P')), tags, tag, speak };
}

async function sendToAll(note, onlyEndpoint) {
  const keys = vapid();
  if (!keys) throw Object.assign(new Error('vapid'), { code: 'not_configured' });
  let devices = await listDevices();
  if (onlyEndpoint) devices = devices.filter((d) => d.subscription.endpoint === onlyEndpoint);
  const payload = JSON.stringify({ ...note, id: Date.now().toString(36), at: new Date().toISOString() });
  const options = {
    vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: 24 * 60 * 60,
    urgency: note.priority >= 4 ? 'high' : note.priority <= 2 ? 'low' : 'normal',
    ...(note.tag && /^[A-Za-z0-9_-]{1,32}$/.test(note.tag) ? { topic: note.tag } : {}),
    timeout: 10000,
  };
  let sent = 0;
  let failed = 0;
  let removed = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.sendNotification(d.subscription, payload, options);
        sent++;
      } catch (err) {
        // 404 / 410: the browser dropped this subscription (uninstalled, permission revoked)
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          removed++;
          await removeDevice(d.id).catch(() => {});
        } else {
          failed++;
          console.warn('[/api/push] send failed:', d.name || d.id, err?.statusCode || '', err?.body || err?.message || err);
        }
      }
    })
  );
  return { sent, failed, removed, devices: devices.length };
}

function missingConfig() {
  const missing = [];
  if (!vapid()) missing.push('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  if (!storeConfig()) missing.push('Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN)');
  return missing;
}

// ---------------------------------------------------------------------------- handler

export default async function handler(req, res) {
  const given = header(req, 'X-Jarvis-Key') || header(req, 'Authorization').replace(/^Bearer\s+/i, '');

  // ---- From n8n / scripts: send a notification
  if (given) {
    if (req.method !== 'POST' && req.method !== 'PUT') return sendJson(res, 405, { error: 'method_not_allowed' });
    const ip = clientIp(req);
    if (!secretMatches(given)) {
      const wait = notifyFailures(ip);
      if (wait) return sendJson(res, 429, { error: 'rate_limited' });
      // Enough to debug a mismatch without revealing anything secret: which variable this
      // deployment compares against, and a short hash of the key that arrived (compare it with
      // the first 8 hex digits of the SHA-256 of the value you meant to send).
      return sendJson(res, 401, {
        error: 'unauthorized',
        checkedAgainst: process.env.JARVIS_NOTIFY_SECRET?.trim() ? 'JARVIS_NOTIFY_SECRET' : process.env.JARVIS_WEBHOOK_SECRET?.trim() ? 'JARVIS_WEBHOOK_SECRET (JARVIS_NOTIFY_SECRET is not set in this deployment)' : 'nothing (no secret set)',
        receivedKeySha256Prefix: createHash('sha256').update(given).digest('hex').slice(0, 8),
        receivedKeyLength: given.length,
      });
    }
    const wait = notifyLimiter(ip);
    if (wait) return sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(wait) });
    const missing = missingConfig();
    if (missing.length) return sendJson(res, 503, { error: 'not_configured', missing });
    let note;
    try {
      note = parseNotification(await readRaw(req), header(req, 'Content-Type'), (...n) => header(req, ...n));
    } catch (err) {
      return sendJson(res, err?.status === 413 ? 413 : 400, { error: 'bad_body' });
    }
    if (!note) return sendJson(res, 400, { error: 'empty_notification', hint: 'Send { "title": "...", "message": "..." }' });
    try {
      return sendJson(res, 200, await sendToAll(note));
    } catch (err) {
      console.warn('[/api/notify] failed:', err?.message || err);
      return sendJson(res, 502, { error: err?.code || 'send_failed' });
    }
  }

  // ---- From the HUD
  if (!guardRequest(req, res, hudLimiter)) return;
  if (!requireSession(req, res)) return;

  if (req.method === 'GET') {
    const keys = vapid();
    const missing = missingConfig();
    let devices = [];
    if (!missing.length) {
      try {
        devices = (await listDevices()).map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, endpointHost: new URL(d.subscription.endpoint).host }));
      } catch (err) {
        return sendJson(res, 502, { error: err?.code || 'store_error' });
      }
    }
    return sendJson(res, 200, { configured: missing.length === 0, missing, publicKey: keys?.publicKey || null, devices });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });

  let body;
  try {
    body = JSON.parse((await readRaw(req)) || '{}');
  } catch {
    return sendJson(res, 400, { error: 'bad_body' });
  }
  const missing = missingConfig();
  if (missing.length) return sendJson(res, 503, { error: 'not_configured', missing });

  try {
    if (body.action === 'subscribe') {
      if (!validSubscription(body.subscription)) return sendJson(res, 400, { error: 'bad_subscription' });
      const { endpoint, keys } = body.subscription;
      const id = idOf(endpoint);
      const devices = await listDevices();
      if (!devices.some((d) => d.id === id) && devices.length >= MAX_DEVICES) return sendJson(res, 409, { error: 'too_many_devices' });
      const name = clean(body.name, 60) || 'Device';
      await redis(['HSET', STORE_KEY, id, JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, name, createdAt: new Date().toISOString() })]);
      return sendJson(res, 200, { ok: true, id });
    }
    if (body.action === 'unsubscribe') {
      if (typeof body.endpoint === 'string') await removeDevice(idOf(body.endpoint));
      else if (typeof body.id === 'string' && /^[0-9a-f]{32}$/.test(body.id)) await removeDevice(body.id);
      return sendJson(res, 200, { ok: true });
    }
    if (body.action === 'test') {
      const result = await sendToAll(
        { title: 'Jarvis', body: 'Test notification. Notifications are working, sir.', url: '/', priority: 3, tags: [], tag: 'jarvis-test', speak: false },
        typeof body.endpoint === 'string' ? body.endpoint : undefined
      );
      return sendJson(res, 200, result);
    }
    return sendJson(res, 400, { error: 'unknown_action' });
  } catch (err) {
    console.warn('[/api/push] failed:', err?.message || err);
    return sendJson(res, 502, { error: err?.code || 'push_failed' });
  }
}
