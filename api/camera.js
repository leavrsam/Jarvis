// Camera snapshots for the HUD screen (SHOW_CAMERA: <name>).
//
// GET /api/camera?camera=<name> fetches the image from the n8n media webhook
// (JARVIS_MEDIA_URL?camera=<name>) with the same X-Jarvis-Key secret as the command proxy, and
// passes it back with its X-Image-Source header ("Live", "Last motion 2:39 PM", ...). The URL
// and secret stay server-side.
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(30); // the screen refreshes once a minute; leaves room for taps
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const CAMERA_RE = /^[\w .-]{1,64}$/;

function sendJson(res, status, obj, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

/** The caption header, limited to short printable text */
function cleanSource(value) {
  if (!value) return '';
  return String(value).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80);
}

function cameraParam(req) {
  if (req.query && typeof req.query.camera === 'string') return req.query.camera;
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('camera') || '';
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    return;
  }
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;

  const mediaUrl = (process.env.JARVIS_MEDIA_URL || '').trim();
  const secret = (process.env.JARVIS_WEBHOOK_SECRET || '').trim();
  if (!mediaUrl || !secret) {
    console.error('[/api/camera] JARVIS_MEDIA_URL or JARVIS_WEBHOOK_SECRET is not set');
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  const camera = cameraParam(req).trim().replace(/\s+/g, ' ');
  if (!CAMERA_RE.test(camera)) {
    sendJson(res, 400, { error: 'bad_camera' });
    return;
  }

  let target;
  try {
    target = new URL(mediaUrl);
    target.searchParams.set('camera', camera);
  } catch {
    console.error('[/api/camera] JARVIS_MEDIA_URL is not a valid URL');
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  const controller = new AbortController();
  const onClientGone = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClientGone);
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { 'X-Jarvis-Key': secret, Accept: 'image/*' },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.warn('[/api/camera] media webhook HTTP', upstream.status);
      sendJson(res, upstream.status === 404 ? 404 : 502, { error: upstream.status === 404 ? 'camera_not_found' : 'camera_error' });
      return;
    }
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/') || type === 'image/svg+xml') {
      console.warn('[/api/camera] media webhook returned', type || 'no content type');
      sendJson(res, 502, { error: 'not_an_image' });
      return;
    }
    const declared = Number(upstream.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) {
      sendJson(res, 502, { error: 'too_large' });
      return;
    }
    const image = Buffer.from(await upstream.arrayBuffer());
    if (image.length > MAX_IMAGE_BYTES) {
      sendJson(res, 502, { error: 'too_large' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(image.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const source = cleanSource(upstream.headers.get('x-image-source'));
    if (source) res.setHeader('X-Image-Source', source);
    res.end(image);
  } catch (err) {
    if (controller.signal.aborted && res.writableEnded) return;
    console.warn('[/api/camera] failed:', err?.name === 'AbortError' ? 'timeout' : err?.message || err);
    if (!res.headersSent) sendJson(res, 504, { error: 'camera_unreachable' });
  } finally {
    clearTimeout(timeout);
    res.off?.('close', onClientGone);
  }
}
