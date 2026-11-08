// Personal data for HUD widgets, from n8n: shopping list, reminders, smart home, deliveries,
// doorbell log and photo album. The browser never sees the webhook URL or secret.
//
//   GET  /api/feed?name=<feed>              -> the feed, normalised (see normalizeFeed)
//   POST /api/feed?name=<feed>  { action, ... } -> forwarded to n8n (check an item, toggle a light)
//
// Webhook per feed: JARVIS_FEED_<NAME>_URL (e.g. JARVIS_FEED_SHOPPING_URL), or one shared
// JARVIS_FEEDS_URL called with ?feed=<name>. Both get the X-Jarvis-Key header
// (JARVIS_WEBHOOK_SECRET), like the command, camera and calendar webhooks.
import { createRateLimiter, guardRequest } from '../requestGuard.js';
import { requireSession } from '../session.js';

const readLimiter = createRateLimiter(60);
const writeLimiter = createRateLimiter(30);
const CACHE_MS = 30 * 1000;
const MAX_BODY = 4096;

/** Feeds, and the actions the HUD may send for each */
export const FEEDS = {
  shopping: ['check', 'add', 'remove'],
  tasks: ['complete', 'add'],
  home: ['toggle', 'set'],
  deliveries: [],
  doorbell: [],
  photos: [],
};

const cache = new Map();

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

const text = (v, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const id = (v, i) => text(v, 120) || String(i);
const https = (v) => {
  try {
    return typeof v === 'string' && new URL(v).protocol === 'https:' ? v : '';
  } catch {
    return '';
  }
};
const time = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d.toISOString();
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function list(body, key) {
  const raw = Array.isArray(body) ? body : Array.isArray(body?.[key]) ? body[key] : Array.isArray(body?.items) ? body.items : [];
  return raw.map((r) => (r && typeof r === 'object' && r.json && typeof r.json === 'object' ? r.json : r)).filter((r) => r && typeof r === 'object');
}

// "Eggs (added by guest)", "Eggs - added by Sarah", "Eggs [guest]": the old way of marking who
// added something, in the text itself. Stripped from the name; it marks the item as a guest's.
const GUEST_NOTE_RE = /\s*(?:[([]\s*(?:added\s+by\s+)?(?:a\s+)?(?:guest|non[-\s]?owner|[^)\]]*?\bguest\b[^)\]]*)\s*[)\]]|[-–—,:]\s*added\s+by\s+(?:a\s+)?(?:guest|non[-\s]?owner|[\p{L}' -]{1,40}))\s*$/iu;

/**
 * Who added an item: the name (if known) and whether it was someone other than the owner.
 * byGuest: true / false when n8n says (addedByOwner, or a guest note in the text); null when
 * it doesn't (the HUD then compares addedBy with the owner's name).
 */
export function addedInfo(r, label) {
  let name = label;
  let byGuest = typeof r.addedByOwner === 'boolean' ? !r.addedByOwner : typeof r.byGuest === 'boolean' ? r.byGuest : null;
  const m = GUEST_NOTE_RE.exec(label);
  if (m && m.index > 0) {
    name = label.slice(0, m.index).trim();
    const who = /added\s+by\s+(?:a\s+)?([\p{L}' -]{1,40})/iu.exec(m[0])?.[1]?.trim();
    if (byGuest === null) byGuest = true;
    if (!r.addedBy && who && !/^(guest|non[-\s]?owner)$/i.test(who)) r = { ...r, addedBy: who };
  }
  return { name, addedBy: text(r.addedBy, 40), byGuest };
}

const HOME_TYPES = new Set(['light', 'switch', 'plug', 'fan', 'lock', 'thermostat', 'sensor', 'cover', 'scene', 'media']);

/** Each feed's response in one safe shape (unknown fields dropped, URLs https only) */
export function normalizeFeed(name, body) {
  switch (name) {
    case 'shopping':
      return {
        items: list(body, 'items')
          .map((r, i) => {
            const who = addedInfo(r, text(r.name || r.title || r.item));
            return { id: id(r.id, i), name: who.name, checked: Boolean(r.checked || r.done), qty: text(r.qty || r.quantity, 20), addedBy: who.addedBy, byGuest: who.byGuest };
          })
          .filter((r) => r.name)
          .slice(0, 100),
      };
    case 'tasks':
      return {
        tasks: list(body, 'tasks')
          .map((r, i) => {
            const who = addedInfo(r, text(r.title || r.name));
            return { id: id(r.id, i), title: who.name, due: time(r.due), done: Boolean(r.done || r.completed || r.status === 'completed'), list: text(r.list, 40), addedBy: who.addedBy, byGuest: who.byGuest };
          })
          .filter((r) => r.title)
          .slice(0, 100),
      };
    case 'home':
      return {
        devices: list(body, 'devices')
          .map((r, i) => ({
            id: id(r.id, i),
            name: text(r.name, 60),
            type: HOME_TYPES.has(r.type) ? r.type : 'switch',
            state: text(r.state, 30),
            value: num(r.value),
            unit: text(r.unit, 8),
            room: text(r.room, 40),
            controllable: r.controllable !== false && r.type !== 'sensor',
          }))
          .filter((r) => r.name)
          .slice(0, 60),
      };
    case 'deliveries':
      return {
        packages: list(body, 'packages')
          .map((r, i) => ({ id: id(r.id, i), title: text(r.title || r.name || r.description), carrier: text(r.carrier, 30), status: text(r.status, 60), eta: time(r.eta), url: https(r.url) }))
          .filter((r) => r.title)
          .slice(0, 40),
      };
    case 'doorbell':
      return {
        events: list(body, 'events')
          .map((r, i) => ({ id: id(r.id, i), time: time(r.time || r.at), camera: text(r.camera, 64), label: text(r.label || r.type, 60), imageUrl: https(r.imageUrl) }))
          .filter((r) => r.time)
          .slice(0, 40),
      };
    case 'photos':
      return {
        photos: list(body, 'photos')
          .map((r) => ({ url: https(r.url || r.baseUrl), caption: text(r.caption || r.title, 120) }))
          .filter((r) => r.url)
          .slice(0, 100),
      };
    default:
      return {};
  }
}

function webhookFor(name) {
  const own = (process.env[`JARVIS_FEED_${name.toUpperCase()}_URL`] || '').trim();
  const shared = (process.env.JARVIS_FEEDS_URL || '').trim();
  try {
    if (own) return new URL(own);
    if (shared) {
      const u = new URL(shared);
      u.searchParams.set('feed', name);
      return u;
    }
  } catch {}
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(Buffer.from(c));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** The action body the HUD may send: known action, short string/number fields only */
export function cleanAction(name, body) {
  if (!body || typeof body !== 'object' || !FEEDS[name]?.includes(body.action)) return null;
  const out = { action: body.action };
  for (const k of ['id', 'name', 'title']) if (body[k] !== undefined) out[k] = text(String(body[k]), 160);
  if (body.checked !== undefined) out.checked = Boolean(body.checked);
  if (body.value !== undefined) {
    const v = num(body.value);
    if (v === null) return null;
    out.value = v;
  }
  if ((out.action === 'add' && !(out.name || out.title)) || (out.action !== 'add' && !out.id)) return null;
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!guardRequest(req, res, req.method === 'GET' ? readLimiter : writeLimiter)) return;
  if (!requireSession(req, res)) return;

  let name = '';
  try {
    name = new URL(req.url, 'http://x').searchParams.get('name') || '';
  } catch {}
  if (!Object.prototype.hasOwnProperty.call(FEEDS, name)) return sendJson(res, 400, { error: 'unknown_feed' });
  const target = webhookFor(name);
  const secret = (process.env.JARVIS_WEBHOOK_SECRET || '').trim();
  if (!target || !secret) return sendJson(res, 503, { error: 'not_configured' });

  try {
    if (req.method === 'GET') {
      const hit = cache.get(name);
      if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, 200, hit.body);
      const upstream = await fetch(target, { headers: { 'X-Jarvis-Key': secret, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!upstream.ok) {
        console.warn(`[/api/feed] ${name} webhook HTTP`, upstream.status);
        return sendJson(res, 502, { error: 'feed_error' });
      }
      const raw = await upstream.text();
      let data;
      try {
        data = raw.trim() ? JSON.parse(raw) : [];
      } catch {
        return sendJson(res, 502, { error: 'not_json' });
      }
      const body = { ...normalizeFeed(name, data), fetchedAt: new Date().toISOString() };
      cache.set(name, { at: Date.now(), body });
      return sendJson(res, 200, body);
    }

    let action;
    try {
      action = cleanAction(name, await readBody(req));
    } catch (err) {
      return sendJson(res, err?.status === 413 ? 413 : 400, { error: 'bad_body' });
    }
    if (!action) return sendJson(res, 400, { error: 'bad_action' });
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'X-Jarvis-Key': secret, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(15000),
    });
    cache.delete(name);
    if (!upstream.ok) {
      console.warn(`[/api/feed] ${name} action HTTP`, upstream.status);
      return sendJson(res, 502, { error: 'feed_error' });
    }
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.warn(`[/api/feed] ${name} failed:`, err?.message || err);
    return sendJson(res, 504, { error: 'feed_unreachable' });
  }
}
