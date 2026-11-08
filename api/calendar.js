// Calendar events for the HUD's left column, through the n8n calendar webhook
// (JARVIS_CALENDAR_URL), with the X-Jarvis-Key secret added here (same as the command proxy).
//
//   GET /api/calendar?mode=calendars
//       -> { calendars: [{ id, name, color, primary, selectedInGoogle }] }
//   GET /api/calendar?timeMin=<ISO>&timeMax=<ISO>[&calendars=<id,id,...>][&tz=<zone>]
//       -> { events: [{ title, start, end, allDay, location, calendarId, calendar, color }],
//            calendarsShown, calendarErrors: [names] }
//   (from/to are accepted as older names for timeMin/timeMax.) Without `calendars`, n8n uses
//   the calendars switched on in Google Calendar.
//
// Events may come as the webhook's own shape, Google Calendar event objects
// (summary/start.dateTime/start.date) or n8n item arrays.
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(30);
const CACHE_MS = 2 * 60 * 1000;
const CALENDAR_LIST_CACHE_MS = 10 * 60 * 1000;
const MAX_EVENTS = 300;
const MAX_RANGE_MS = 62 * 86400_000;
const MAX_CALENDARS = 30;
// Google calendar ids: emails, "...@group.calendar.google.com", "en.usa#holiday@group.v.calendar.google.com"
const CALENDAR_ID_RE = /^[\w.@#+%=-]{1,200}$/;
const cache = new Map(); // key -> { at, body }

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
/** Only plain hex colours reach the page */
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v.trim()) ? v.trim() : '');

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
    calendar: text(e.calendarName || e.calendar || e.organizer?.displayName || '', 60),
    calendarId: text(e.calendarId, 200),
    color: color(e.color || e.backgroundColor),
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

/** The webhook's calendar list → [{ id, name, color, primary, selectedInGoogle }], primary first */
export function normalizeCalendars(body) {
  const list = Array.isArray(body?.calendars) ? body.calendars : Array.isArray(body) ? body : [];
  return list
    .map((raw) => (raw && typeof raw === 'object' && raw.json ? raw.json : raw))
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && CALENDAR_ID_RE.test(c.id))
    .map((c) => ({
      id: c.id,
      name: text(c.name || c.summary || c.id, 80),
      color: color(c.color || c.backgroundColor),
      primary: Boolean(c.primary),
      selectedInGoogle: c.selectedInGoogle === undefined ? Boolean(c.selected) : Boolean(c.selectedInGoogle),
    }))
    .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1));
}

/** calendarErrors may be names, ids or objects: return short names */
export function normalizeCalendarErrors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? text(v, 80) : text(v?.name || v?.calendarName || v?.calendarId || v?.id || '', 80)))
    .filter(Boolean)
    .slice(0, 10);
}

async function callWebhook(target, secret) {
  const upstream = await fetch(target, {
    headers: { 'X-Jarvis-Key': secret, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) throw Object.assign(new Error(`HTTP ${upstream.status}`), { code: 'calendar_error' });
  const raw = await upstream.text();
  try {
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    throw Object.assign(new Error('not JSON'), { code: 'not_json' });
  }
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
  let target;
  try {
    target = new URL(calendarUrl);
  } catch {
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  // The calendar list (for the HUD's on/off switches)
  if (q.get('mode') === 'calendars') {
    target.searchParams.set('mode', 'calendars');
    const hit = cache.get('calendars');
    if (hit && Date.now() - hit.at < CALENDAR_LIST_CACHE_MS) return sendJson(res, 200, hit.body);
    try {
      const body = { calendars: normalizeCalendars(await callWebhook(target, secret)) };
      cache.set('calendars', { at: Date.now(), body });
      sendJson(res, 200, body);
    } catch (err) {
      console.warn('[/api/calendar] calendar list failed:', err?.message || err);
      sendJson(res, err?.code ? 502 : 504, { error: err?.code || 'calendar_unreachable' });
    }
    return;
  }

  // Events
  const from = new Date(q.get('timeMin') || q.get('from') || '');
  const to = new Date(q.get('timeMax') || q.get('to') || '');
  const tz = /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/.test(q.get('tz') || '') ? q.get('tz') : '';
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > MAX_RANGE_MS) {
    sendJson(res, 400, { error: 'bad_range' });
    return;
  }
  const calendarsParam = q.get('calendars');
  let calendars = null;
  if (calendarsParam !== null && calendarsParam !== '') {
    calendars = calendarsParam.split(',').map((c) => c.trim()).filter(Boolean);
    if (calendars.length > MAX_CALENDARS || !calendars.every((c) => CALENDAR_ID_RE.test(c))) {
      sendJson(res, 400, { error: 'bad_calendars' });
      return;
    }
  }

  target.searchParams.set('timeMin', from.toISOString());
  target.searchParams.set('timeMax', to.toISOString());
  if (tz) target.searchParams.set('tz', tz);
  // URLSearchParams encodes '#' and '@' in ids
  if (calendars) target.searchParams.set('calendars', calendars.join(','));

  const key = `events|${from.toISOString()}|${to.toISOString()}|${tz}|${calendars ? calendars.join(',') : '*'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return sendJson(res, 200, hit.body);

  try {
    const data = await callWebhook(target, secret);
    const body = {
      events: normalizeEvents(data),
      calendarsShown: Array.isArray(data?.calendarsShown) ? data.calendarsShown.map((c) => text(typeof c === 'string' ? c : c?.name || c?.id || '', 80)).filter(Boolean) : [],
      calendarErrors: normalizeCalendarErrors(data?.calendarErrors),
      fetchedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    sendJson(res, 200, body);
  } catch (err) {
    console.warn('[/api/calendar] failed:', err?.message || err);
    sendJson(res, err?.code ? 502 : 504, { error: err?.code || 'calendar_unreachable' });
  }
}
