// Shared protection for the app's server routes: same-origin only + a per-IP rate limit.
// (Files under api/_lib are helpers; Vercel doesn't expose underscore paths as endpoints.)

/** Client IP as seen through Vercel's proxy (first X-Forwarded-For hop). */
export function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return forwarded || (req.headers['x-real-ip'] || '').toString() || req.socket?.remoteAddress || 'unknown';
}

/**
 * True only for requests made by this app's own pages. Browsers send Origin on POST and
 * Sec-Fetch-Site on all modern fetches; another site, or a script without these headers, fails.
 * JARVIS_ALLOWED_ORIGINS (comma-separated) can allow extra origins.
 */
export function isSameOrigin(req) {
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

/**
 * Sliding-window limiter, in memory: it applies per server instance, which is enough to stop a
 * runaway loop or casual abuse, but it isn't a shared global limit.
 * Returns a function: (ip) => seconds to wait (0 = allowed).
 */
export function createRateLimiter(limit, windowMs = 60_000) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) {
      for (const [key, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(key);
    }
    return 0;
  };
}

function reject(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/**
 * Apply both checks. Returns true if the request may proceed; otherwise it has already been
 * answered (403 cross-origin, 429 rate limited).
 */
export function guardRequest(req, res, limiter) {
  if (!isSameOrigin(req)) {
    reject(res, 403, { error: 'forbidden' });
    return false;
  }
  const retryAfter = limiter(clientIp(req));
  if (retryAfter) {
    reject(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfter) });
    return false;
  }
  return true;
}
