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
/** Several cameras in one reply (?multi=1): at most this many, and this much in total, since
 *  Vercel caps a function's response at 4.5 MB */
const MAX_CAMERAS = 8;
const MAX_MULTI_BYTES = 4_000_000;
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
/** One item of a JSON reply → image (base64 or via its https link), or an error */
async function itemImage(item, signal) {
  const source = typeof item?.source === 'string' ? item.source : typeof item?.caption === 'string' ? item.caption : '';
  const camera = typeof item?.camera === 'string' ? item.camera : typeof item?.name === 'string' ? item.name : typeof item?.title === 'string' ? item.title : '';
  // base64 (optionally a data: URI), e.g. { data, mimeType } or { image: "data:image/jpeg;base64,..." }
  for (const key of ['data', 'base64', 'image', 'imageBase64', 'snapshot']) {
    const v = item?.[key];
    if (typeof v !== 'string' || v.length < 100) continue;
    const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(v);
    const raw = Buffer.from(m ? m[2] : v, 'base64');
    const t = m ? m[1].toLowerCase() : sniffImage(raw) || String(item.mimeType || '').toLowerCase();
    if (raw.length && raw.length <= MAX_IMAGE_BYTES && isImageType(t)) return { image: raw, type: t, source, camera };
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
      return { image: img, type: finalType, source, camera };
    } catch (err) {
      return { error: 'camera_unreachable', detail: `couldn't fetch the snapshot link (${err?.message || err})` };
    }
  }
  const keys = item && typeof item === 'object' ? Object.keys(item).slice(0, 8).join(', ') : typeof item;
  return { error: 'not_an_image', detail: `the media webhook answered with JSON (${keys}) but no image, image link or base64 data` };
}

/**
 * Every image in a reply: raw image bytes (one), or JSON with one or several cameras, as an
 * object, an array, n8n items, or { cameras | images | snapshots: [...] }. Returns the images
 * found, or the first error if there are none.
 */
async function readImages(upstream, signal) {
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES * 4) return { error: 'too_large', detail: `${declared} bytes` };
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (isImageType(type) || sniffImage(bytes)) {
    if (bytes.length > MAX_IMAGE_BYTES) return { error: 'too_large', detail: `${bytes.length} bytes` };
    return { images: [{ image: bytes, type: isImageType(type) ? type : sniffImage(bytes), source: '', camera: '' }] };
  }
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { error: 'not_an_image', detail: `the media webhook answered with ${type || 'no content type'}, not an image` };
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.cameras)
      ? data.cameras
      : Array.isArray(data?.images)
        ? data.images
        : Array.isArray(data?.snapshots)
          ? data.snapshots
          : [data];
  const items = list.slice(0, MAX_CAMERAS).map((r) => (r && typeof r === 'object' && r.json && typeof r.json === 'object' ? r.json : r));
  const results = await Promise.all(items.map((item) => itemImage(item, signal)));
  const images = results.filter((r) => !r.error);
  return images.length ? { images } : results[0] || { error: 'not_an_image', detail: 'the media webhook answered with an empty list' };
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
    const missing = !mediaUrl ? 'JARVIS_MEDIA_URL is not set' : 'JARVIS_WEBHOOK_SECRET is not set';
    console.error(`[/api/camera] ${missing}`);
    sendJson(res, 503, { error: 'not_configured', detail: `${missing} in this deployment` });
    return;
  }

  const camera = cameraParam(req).trim().replace(/\s+/g, ' ');
  let multi = false;
  try {
    multi = new URL(req.url, 'http://localhost').searchParams.get('multi') === '1';
  } catch {}
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
    sendJson(res, 503, { error: 'not_configured', detail: 'JARVIS_MEDIA_URL is set but is not a valid URL (it should start with https://)' });
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
    const found = await readImages(upstream, controller.signal);
    if (found.error) return fail(502, found.error, found.detail);
    if (multi) {
      // All of them, as data URLs, within the response size limit
      const images = [];
      let total = 0;
      let skipped = 0;
      for (const img of found.images) {
        const b64 = img.image.toString('base64');
        if (total + b64.length > MAX_MULTI_BYTES) {
          skipped++;
          continue;
        }
        total += b64.length;
        images.push({
          camera: cleanSource(img.camera) || '',
          caption: cleanSource(img.source || (found.images.length === 1 ? upstream.headers.get('x-image-source') : '')) || '',
          src: `data:${img.type};base64,${b64}`,
        });
      }
      return sendJson(res, 200, { images, skipped });
    }
    const result = found.images[0];
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
