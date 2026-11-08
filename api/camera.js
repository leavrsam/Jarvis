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

const isImageType = (t) => t.startsWith('image/') && t !== 'image/svg+xml';

/** Image bytes from a response: raw image, or JSON with a link / base64 (common n8n replies) */
async function readImage(upstream, signal) {
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) return { error: 'too_large', detail: `${declared} bytes` };
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'too_large', detail: `${bytes.length} bytes` };
  if (isImageType(type)) return { image: bytes, type };
  // Some setups send image bytes with a generic type: recognise JPEG / PNG / WebP / GIF
  const sniffed = sniffImage(bytes);
  if (sniffed) return { image: bytes, type: sniffed };

  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { error: 'not_an_image', detail: `the media webhook answered with ${type || 'no content type'}, not an image` };
  }
  const item = Array.isArray(data) ? data[0]?.json ?? data[0] : data?.json ?? data;
  const source = typeof item?.source === 'string' ? item.source : typeof item?.caption === 'string' ? item.caption : '';
  // base64 (optionally a data: URI), e.g. { data, mimeType } or { image: "data:image/jpeg;base64,..." }
  for (const key of ['data', 'base64', 'image', 'imageBase64', 'snapshot']) {
    const v = item?.[key];
    if (typeof v !== 'string' || v.length < 100) continue;
    const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(v);
    const raw = Buffer.from(m ? m[2] : v, 'base64');
    const t = m ? m[1].toLowerCase() : sniffImage(raw) || String(item.mimeType || '').toLowerCase();
    if (raw.length && raw.length <= MAX_IMAGE_BYTES && isImageType(t)) return { image: raw, type: t, source };
  }
  // a link to the snapshot, e.g. { url } / { imageUrl } / { snapshotUrl }
  for (const key of ['url', 'imageUrl', 'snapshotUrl', 'image', 'snapshot', 'href']) {
    const v = item?.[key];
    if (typeof v !== 'string' || !/^https:\/\//i.test(v)) continue;
    try {
      const r = await fetch(v, { headers: { Accept: 'image/*' }, signal, redirect: 'follow' });
      if (!r.ok) return { error: 'camera_error', detail: `the snapshot link answered HTTP ${r.status}` };
      const t = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const img = Buffer.from(await r.arrayBuffer());
      if (img.length > MAX_IMAGE_BYTES) return { error: 'too_large', detail: `${img.length} bytes` };
      const finalType = isImageType(t) ? t : sniffImage(img);
      if (!finalType) return { error: 'not_an_image', detail: `the snapshot link returned ${t || 'no content type'}` };
      return { image: img, type: finalType, source };
    } catch (err) {
      return { error: 'camera_unreachable', detail: `couldn't fetch the snapshot link (${err?.message || err})` };
    }
  }
  const keys = item && typeof item === 'object' ? Object.keys(item).slice(0, 8).join(', ') : typeof item;
  return { error: 'not_an_image', detail: `the media webhook answered with JSON (${keys}) but no image, image link or base64 data` };
}

/** Image type from the first bytes, or '' */
export function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 6 && b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return '';
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
    sendJson(res, 503, { error: 'not_configured', detail: 'JARVIS_MEDIA_URL (or JARVIS_WEBHOOK_SECRET) is not set in Vercel' });
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

  const fail = (status, error, detail) => {
    console.warn(`[/api/camera] ${camera}: ${error}${detail ? ` (${detail})` : ''}`);
    sendJson(res, status, { error, detail: detail ? String(detail).slice(0, 160) : undefined });
  };

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: { 'X-Jarvis-Key': secret, Accept: 'image/*, application/json' },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      const msg = (() => {
        try {
          const j = JSON.parse(body);
          return j?.message || j?.error || '';
        } catch {
          return body.slice(0, 120);
        }
      })();
      if (upstream.status === 404) return fail(404, 'camera_not_found', msg || 'the media webhook has no camera by that name (or the webhook URL is wrong / not active)');
      if (upstream.status === 401 || upstream.status === 403) return fail(502, 'camera_rejected', 'the media webhook refused the X-Jarvis-Key secret');
      return fail(502, 'camera_error', `media webhook HTTP ${upstream.status}${msg ? `: ${msg}` : ''}`);
    }
    const result = await readImage(upstream, controller.signal);
    if (result.error) return fail(502, result.error, result.detail);
    res.statusCode = 200;
    res.setHeader('Content-Type', result.type);
    res.setHeader('Content-Length', String(result.image.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const source = cleanSource(result.source || upstream.headers.get('x-image-source'));
    if (source) res.setHeader('X-Image-Source', source);
    res.end(result.image);
  } catch (err) {
    if (controller.signal.aborted && res.writableEnded) return;
    console.warn('[/api/camera] failed:', err?.name === 'AbortError' ? 'timeout' : err?.message || err);
    if (!res.headersSent) sendJson(res, 504, { error: 'camera_unreachable', detail: err?.name === 'AbortError' ? 'the media webhook took longer than 20 s' : 'could not reach the media webhook' });
  } finally {
    clearTimeout(timeout);
    res.off?.('close', onClientGone);
  }
}
