// Login / logout / session status for the HUD.
//   GET  /api/auth                        -> { authenticated, configured }
//   POST /api/auth { action: 'login', passcode }
//   POST /api/auth { action: 'logout' }
import { clientIp, createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import {
  authConfigured,
  clearSession,
  createSession,
  lockoutSeconds,
  passwordMatches,
  readSession,
  recordFailure,
  recordSuccess,
  requireSession,
} from './_lib/session.js';

const limiter = createRateLimiter(30);

function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (!guardRequest(req, res, limiter)) return;

  if (req.method === 'GET') {
    // Status check on page load; renews the cookie if it's due
    if (authConfigured() && readSession(req)) {
      requireSession(req, res); // only to renew; always passes here
      json(res, 200, { authenticated: true, configured: true });
    } else {
      json(res, 200, { authenticated: false, configured: authConfigured() });
    }
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    json(res, 400, { error: 'invalid_json' });
    return;
  }

  if (body.action === 'logout') {
    clearSession(res);
    json(res, 200, { authenticated: false });
    return;
  }

  if (body.action !== 'login') {
    json(res, 400, { error: 'unknown_action' });
    return;
  }
  if (!authConfigured()) {
    json(res, 503, { error: 'auth_not_configured' });
    return;
  }

  const ip = clientIp(req);
  const locked = lockoutSeconds(ip);
  if (locked) {
    json(res, 429, { error: 'locked', retryAfter: locked }, { 'Retry-After': String(locked) });
    return;
  }

  if (await passwordMatches(body.passcode)) {
    recordSuccess(ip);
    createSession(res);
    json(res, 200, { authenticated: true });
    return;
  }

  const remaining = recordFailure(ip);
  const nowLocked = lockoutSeconds(ip);
  if (nowLocked) {
    json(res, 429, { error: 'locked', retryAfter: nowLocked }, { 'Retry-After': String(nowLocked) });
    return;
  }
  json(res, 401, { error: 'invalid_passcode', attemptsLeft: remaining });
}
