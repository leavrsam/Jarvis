// Calendar events for the HUD's left column.
//
// GET /api/calendar?from=<ISO>&to=<ISO>&tz=<IANA zone> calls the n8n calendar webhook
// (JARVIS_CALENDAR_URL) with timeMin/timeMax/tz and the X-Jarvis-Key secret (same as the
// command proxy), and returns the events in one simple shape. Accepts what n8n's Google Calendar
// node returns (event objects with summary/start.dateTime/start.date), n8n item arrays, or
// already-simple { title, start, end, allDay, location } objects.
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(30);
const CACHE_MS = 2 * 60 * 1000;
const MAX_EVENTS = 60;
let cache = null; // { key, at, body }

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function params(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** One event in any of the accepted shapes → { title, start, end, allDay, location, calendar } */
export function normalizeEvent(raw) {
  const e = raw && typeof raw === 'object' && raw.json && typeof raw.json === 'object' ? raw.json : raw;
  if (!e || typeof e !== 'object') return null;
  if (e.status === 'cancelled') return null;
  const startObj = e.start;
  const endObj = e.end;
  // Google: start: { dateTime } or { date } (all-day). Simple: start: ISO string.
  const startStr = typeof startObj === 'string' ? startObj : startObj?.dateTime || startObj?.date;
  const endStr = typeof endObj === 'string' ? endObj : endObj?.dateTime || endObj?.date;
  if (!startStr) return null;
  const allDay =
    typeof e.allDay === 'boolean'
      ? e.allDay
      : typeof startObj === 'object'
        ? Boolean(startObj?.date && !startObj?.dateTime)
        : /^\d{4}-\d{2}-\d{2}$/.test(startStr);
  const start = new Date(allDay && /^\d{4}-\d{2}-\d{2}$/.test(startStr) ? `${startStr}T00:00:00` : startStr);
  if (Number.isNaN(start.getTime())) return null;
  let end = endStr ? new Date(allDay && /^\d{4}-\d{2}-\d{2}$/.test(endStr) ? `${endStr}T00:00:00` : endStr) : null;
  if (end && Number.isNaN(end.getTime())) end = null;
  return {
    title: text(e.title || e.summary || e.name, 160) || '(No title)',
    start: allDay ? startStr.slice(0, 10) : start.toISOString(),
    end: end ? (allDay ? String(endStr).slice(0, 10) : end.toISOString()) : null,
    allDay,
    location: text(e.location, 120),
    calendar: text(e.calendar || e.organizer?.displayName || '', 60),
  };
}

export function normalizeEvents(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : Array.isArray(body?.items) ? body.items : body ? [body] : [];
  return list
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1))
    .slice(0, MAX_EVENTS);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;

  const calendarUrl = (process.env.JARVIS_CALENDAR_URL || '').trim();
  const secret = (process.env.JARVIS_WEBHOOK_SECRET || '').trim();
  if (!calendarUrl || !secret) {
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  const q = params(req);
  const from = new Date(q.get('from') || '');
  const to = new Date(q.get('to') || '');
  const tz = /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/.test(q.get('tz') || '') ? q.get('tz') : 'UTC';
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 8 * 86400_000) {
    sendJson(res, 400, { error: 'bad_range' });
    return;
  }

  const key = `${from.toISOString()}|${to.toISOString()}|${tz}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    sendJson(res, 200, cache.body);
    return;
  }

  let target;
  try {
    target = new URL(calendarUrl);
    target.searchParams.set('timeMin', from.toISOString());
    target.searchParams.set('timeMax', to.toISOString());
    target.searchParams.set('tz', tz);
  } catch {
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'X-Jarvis-Key': secret, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.warn('[/api/calendar] calendar webhook HTTP', upstream.status);
      sendJson(res, 502, { error: 'calendar_error' });
      return;
    }
    const raw = await upstream.text();
    let data;
    try {
      data = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      sendJson(res, 502, { error: 'not_json' });
      return;
    }
    const body = { events: normalizeEvents(data), fetchedAt: new Date().toISOString() };
    cache = { key, at: Date.now(), body };
    sendJson(res, 200, body);
  } catch (err) {
    console.warn('[/api/calendar] failed:', err?.message || err);
    sendJson(res, 504, { error: 'calendar_unreachable' });
  }
}
