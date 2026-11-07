// Server-side proxy for the n8n Jarvis webhook.
//
// The browser posts here (same origin); this adds the X-Jarvis-Key secret and streams n8n's
// reply straight back. The webhook URL and secret live only in server environment variables
// (JARVIS_WEBHOOK_URL, JARVIS_WEBHOOK_SECRET) and never reach the browser.
//
// The request body is forwarded byte for byte, so speaker / speakerConfidence /
// isAuthorizedOwner arrive at n8n exactly as the app set them.

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 30; // requests per IP per minute
const RATE_WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 55_000; // just under the function's 60s limit

// Per-IP sliding window. In-memory, so it applies per server instance (good enough to stop a
// runaway loop or casual abuse; not a distributed limiter).
const hits = new Map();

function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return forwarded || (req.headers['x-real-ip'] || '').toString() || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (!times.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(key);
  }
  return 0;
}

/**
 * Same-origin only. Browsers send Origin on POST and Sec-Fetch-Site on all modern fetches;
 * a request from another site (or a script without these headers) is refused.
 */
function isSameOrigin(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  const origin = (req.headers.origin || '').toString();
  const fetchSite = (req.headers['sec-fetch-site'] || '').toString();
  const extra = (process.env.JARVIS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origin) {
    if (extra.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return fetchSite === 'same-origin';
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

/** Raw request bytes, so the body is forwarded unchanged. Falls back to a pre-parsed body. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  if (req.readable !== false && !req.readableEnded) {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(Buffer.from(chunk));
    }
  }
  if (chunks.length) return Buffer.concat(chunks);
  // Some runtimes parse the body before the handler runs
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  return Buffer.alloc(0);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    return;
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  const retryAfter = rateLimited(clientIp(req));
  if (retryAfter) {
    sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfter) });
    return;
  }

  const webhookUrl = (process.env.JARVIS_WEBHOOK_URL || '').trim();
  const secret = (process.env.JARVIS_WEBHOOK_SECRET || '').trim();
  if (!webhookUrl || !secret) {
    console.error('[/api/jarvis-command] JARVIS_WEBHOOK_URL or JARVIS_WEBHOOK_SECRET is not set');
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
    JSON.parse(body.toString('utf8')); // must be JSON; forwarded as the original bytes
  } catch (err) {
    sendJson(res, err?.status === 413 ? 413 : 400, { error: err?.status === 413 ? 'too_large' : 'invalid_json' });
    return;
  }

  // Cancel the n8n call if the browser goes away (user interrupted Jarvis) or it runs too long
  const controller = new AbortController();
  const onClientGone = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClientGone);
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: (req.headers.accept || 'application/x-ndjson, application/json').toString(),
        'X-Jarvis-Key': secret,
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (res.writableEnded || res.destroyed) return;
    const aborted = controller.signal.aborted;
    console.warn('[/api/jarvis-command] upstream request failed:', aborted ? 'aborted/timeout' : err?.message || err);
    sendJson(res, aborted ? 504 : 502, { error: aborted ? 'upstream_timeout' : 'upstream_unreachable' });
    return;
  }

  if (!upstream.ok) {
    clearTimeout(timeout);
    // Don't relay n8n's error body; it can contain backend detail. 401/403 = wrong or missing key.
    const rejected = upstream.status === 401 || upstream.status === 403;
    console.warn(`[/api/jarvis-command] n8n responded HTTP ${upstream.status}${rejected ? ' (check JARVIS_WEBHOOK_SECRET)' : ''}`);
    upstream.body?.cancel().catch(() => {});
    sendJson(res, 502, { error: rejected ? 'upstream_rejected' : 'upstream_error', status: upstream.status });
    return;
  }

  // Stream the reply through untouched (NDJSON or JSON), chunk by chunk
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  try {
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        res.write(chunk);
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) console.warn('[/api/jarvis-command] stream interrupted:', err?.message || err);
  } finally {
    clearTimeout(timeout);
    res.off('close', onClientGone);
    if (!res.writableEnded) res.end();
  }
}
