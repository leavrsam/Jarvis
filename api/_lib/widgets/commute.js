// Drive time for the HUD's commute widget.
//
//   GET /api/commute?from=<lat>,<lon>&to=<address or lat,lon>
//     -> { minutes, typicalMinutes, miles, traffic, source, destination }
//
// With GOOGLE_MAPS_API_KEY set (Routes API enabled), times include live traffic. Without it,
// the address is looked up with OpenStreetMap (Nominatim) and the drive time comes from OSRM:
// free, no key, but no traffic.
import { createRateLimiter, guardRequest } from '../requestGuard.js';
import { requireSession } from '../session.js';

const limiter = createRateLimiter(20);
const ROUTE_CACHE_MS = 5 * 60 * 1000;
const GEOCODE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const UA = 'JarvisHUD/1.0 (personal home assistant)';
const routeCache = new Map();
const geoCache = new Map();

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** "40.52,-111.86" → { lat, lon } (null if it isn't a coordinate pair) */
export function parseLatLon(v) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(v || '');
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

async function geocode(address) {
  const key = address.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEOCODE_CACHE_MS) return hit.p;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: address, format: 'json', limit: '1' })}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const [first] = await res.json();
  if (!first) throw Object.assign(new Error('address not found'), { code: 'not_found' });
  const p = { lat: Number(first.lat), lon: Number(first.lon), label: String(first.display_name || address).split(',').slice(0, 2).join(',') };
  geoCache.set(key, { at: Date.now(), p });
  return p;
}

async function osrm(from, to) {
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`route HTTP ${res.status}`);
  const d = await res.json();
  const r = d?.routes?.[0];
  if (!r) throw Object.assign(new Error('no route'), { code: 'no_route' });
  return { minutes: Math.round(r.duration / 60), typicalMinutes: null, miles: Math.round((r.distance / 1609.34) * 10) / 10, traffic: false, source: 'OpenStreetMap' };
}

async function google(key, from, to) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
      destination: typeof to === 'string' ? { address: to } : { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google HTTP ${res.status}`);
  const r = (await res.json())?.routes?.[0];
  if (!r) throw Object.assign(new Error('no route'), { code: 'no_route' });
  const secs = (v) => Number(String(v || '0').replace('s', ''));
  return {
    minutes: Math.round(secs(r.duration) / 60),
    typicalMinutes: r.staticDuration ? Math.round(secs(r.staticDuration) / 60) : null,
    miles: Math.round((Number(r.distanceMeters || 0) / 1609.34) * 10) / 10,
    traffic: true,
    source: 'Google Maps',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;
  let q;
  try {
    q = new URL(req.url, 'http://x').searchParams;
  } catch {
    return sendJson(res, 400, { error: 'bad_request' });
  }
  const from = parseLatLon(q.get('from'));
  const toRaw = (q.get('to') || '').replace(/\s+/g, ' ').trim();
  if (!from || !toRaw || toRaw.length > 200) return sendJson(res, 400, { error: 'bad_request' });

  const cacheKey = `${from.lat.toFixed(3)},${from.lon.toFixed(3)}|${toRaw.toLowerCase()}`;
  const hit = routeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return sendJson(res, 200, hit.body);

  try {
    const gKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    const toPoint = parseLatLon(toRaw);
    let body;
    if (gKey) {
      body = { ...(await google(gKey, from, toPoint || toRaw)), destination: toRaw };
    } else {
      // The free services hiccup now and then: one quick retry
      const retry = async (fn) => {
        try {
          return await fn();
        } catch (err) {
          if (err?.code) throw err;
          await new Promise((r) => setTimeout(r, 800));
          return fn();
        }
      };
      const dest = toPoint ? { ...toPoint, label: toRaw } : await retry(() => geocode(toRaw));
      body = { ...(await retry(() => osrm(from, dest))), destination: dest.label };
    }
    routeCache.set(cacheKey, { at: Date.now(), body });
    sendJson(res, 200, body);
  } catch (err) {
    console.warn('[/api/commute] failed:', err?.message || err);
    sendJson(res, err?.code ? 404 : 502, { error: err?.code || 'route_error' });
  }
}
