// Server-side login sessions for the Jarvis HUD.
//
// - The passcode lives only in JARVIS_LOGIN_PASSWORD (server env). It's checked with scrypt
//   (deliberately slow) and a constant-time comparison.
// - A successful login sets an HttpOnly, Secure, SameSite=Strict cookie signed with
//   JARVIS_SESSION_SECRET (HMAC-SHA256). It lasts 30 days and is renewed whenever it's used,
//   so an always-on device stays logged in indefinitely.
// - Changing JARVIS_SESSION_SECRET logs every device out. Changing the password does too,
//   because sessions are bound to a fingerprint of it.
import crypto from 'node:crypto';

export const SESSION_COOKIE = '__Host-jarvis_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** Re-issue the cookie (fresh 30 days) once it is this old */
const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

function sessionSecret() {
  const secret = (process.env.JARVIS_SESSION_SECRET || '').trim();
  return secret.length >= MIN_SECRET_LENGTH ? secret : '';
}

function loginPassword() {
  return process.env.JARVIS_LOGIN_PASSWORD || '';
}

/** Both env vars present and the session secret long enough */
export function authConfigured() {
  return Boolean(sessionSecret() && loginPassword());
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Short fingerprint of the current password, so changing it invalidates old sessions */
function passwordFingerprint(secret) {
  return crypto.createHmac('sha256', secret).update(`pw:${loginPassword()}`).digest('base64url').slice(0, 16);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').toString().split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(value, maxAgeSeconds) {
  // __Host- prefix: browsers only accept it with Secure, Path=/ and no Domain
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function appendSetCookie(res, value) {
  const existing = res.getHeader?.('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader('Set-Cookie', [...list, value]);
}

function issue(res, secret) {
  const now = Date.now();
  const payload = b64url(
    JSON.stringify({ v: 1, iat: now, exp: now + SESSION_MS, pw: passwordFingerprint(secret), n: crypto.randomUUID() })
  );
  appendSetCookie(res, cookieHeader(`${payload}.${sign(payload, secret)}`, Math.floor(SESSION_MS / 1000)));
}

/** Start a session (after a successful login). */
export function createSession(res) {
  const secret = sessionSecret();
  if (!secret) throw new Error('JARVIS_SESSION_SECRET missing or shorter than 32 characters');
  issue(res, secret);
}

export function clearSession(res) {
  appendSetCookie(res, cookieHeader('', 0));
}

/** The verified session payload, or null. */
export function readSession(req) {
  const secret = sessionSecret();
  if (!secret) return null;
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.v !== 1 || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    if (data.pw !== passwordFingerprint(secret)) return null; // password changed since login
    return data;
  } catch {
    return null;
  }
}

/**
 * Gate for protected routes. Returns true if the request has a valid session (renewing the
 * cookie when it's more than 12 hours old); otherwise answers 401 and returns false.
 */
export function requireSession(req, res) {
  if (!authConfigured()) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'auth_not_configured' }));
    return false;
  }
  const session = readSession(req);
  if (!session) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'unauthenticated' }));
    return false;
  }
  if (Date.now() - session.iat > RENEW_AFTER_MS) issue(res, sessionSecret());
  return true;
}

// ---------------------------------------------------------------------------
// Passcode check: scrypt (slow on purpose) + constant-time comparison
// ---------------------------------------------------------------------------
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const salt = crypto.randomBytes(16); // per server instance; only used for this comparison
let expectedHash = null;
let expectedFor = null;

function scrypt(value) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(value, salt, 32, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function passwordMatches(candidate) {
  const password = loginPassword();
  if (!password) return false;
  if (!expectedHash || expectedFor !== password) {
    expectedHash = await scrypt(password);
    expectedFor = password;
  }
  const given = await scrypt(String(candidate ?? '').slice(0, 512));
  return crypto.timingSafeEqual(given, expectedHash);
}

// ---------------------------------------------------------------------------
// Lockout: 5 failures per IP in 15 minutes locks that IP for 15 minutes; 20 failures from all
// IPs in an hour locks new logins for 15 minutes. Existing sessions keep working during a lockout.
// In memory, so it applies per server instance.
// ---------------------------------------------------------------------------
const PER_IP_FAILURES = 5;
const PER_IP_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_FAILURES = 20;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const failuresByIp = new Map(); // ip -> timestamps
let globalFailures = [];
const lockedUntilByIp = new Map();
let globalLockedUntil = 0;

/** Seconds until this IP may try again (0 = not locked). */
export function lockoutSeconds(ip) {
  const now = Date.now();
  const until = Math.max(lockedUntilByIp.get(ip) || 0, globalLockedUntil);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function recordFailure(ip) {
  const now = Date.now();
  const recent = (failuresByIp.get(ip) || []).filter((t) => now - t < PER_IP_WINDOW_MS);
  recent.push(now);
  failuresByIp.set(ip, recent);
  if (recent.length >= PER_IP_FAILURES) lockedUntilByIp.set(ip, now + LOCK_MS);

  globalFailures = globalFailures.filter((t) => now - t < GLOBAL_WINDOW_MS);
  globalFailures.push(now);
  if (globalFailures.length >= GLOBAL_FAILURES) globalLockedUntil = now + LOCK_MS;

  if (failuresByIp.size > 5000) {
    for (const [key, times] of failuresByIp) if (!times.some((t) => now - t < PER_IP_WINDOW_MS)) failuresByIp.delete(key);
  }
  return Math.max(0, PER_IP_FAILURES - recent.length);
}

export function recordSuccess(ip) {
  failuresByIp.delete(ip);
  lockedUntilByIp.delete(ip);
}
