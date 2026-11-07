// Browser side of the server login (api/auth.js). The passcode is checked on the server; the
// session lives in an HttpOnly cookie the page can't read, so nothing secret is stored here.

export interface SessionStatus {
  authenticated: boolean;
  /** False when the server is missing JARVIS_LOGIN_PASSWORD / JARVIS_SESSION_SECRET */
  configured: boolean;
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'network' };

const AUTH_REQUIRED_EVENT = 'jarvis:auth-required';

export async function checkSession(): Promise<SessionStatus> {
  try {
    const res = await fetch('/api/auth', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return { authenticated: false, configured: true };
    const data = await res.json();
    return { authenticated: Boolean(data.authenticated), configured: data.configured !== false };
  } catch {
    return { authenticated: false, configured: true };
  }
}

export async function login(passcode: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', passcode }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.authenticated) return { ok: true };
  if (res.status === 429) {
    return { ok: false, reason: 'locked', retryAfterSeconds: Number(data.retryAfter || res.headers.get('Retry-After')) || 900 };
  }
  if (res.status === 503 || data.error === 'auth_not_configured') return { ok: false, reason: 'not_configured' };
  if (res.status === 401) return { ok: false, reason: 'invalid', attemptsLeft: Number(data.attemptsLeft ?? 0) };
  return { ok: false, reason: 'network' };
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
  } catch {}
}

/** Call when a protected route answers 401: the app shows the login screen again. */
export function notifyAuthRequired() {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

export function onAuthRequired(handler: () => void): () => void {
  window.addEventListener(AUTH_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
}
