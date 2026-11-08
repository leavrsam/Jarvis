// Short-lived Deepgram token for live (streaming) transcription in the browser.
//
// The browser can't hold DEEPGRAM_API_KEY, so it asks here for a temporary token (Deepgram's
// /v1/auth/grant, valid ~30 s) and uses it only to open one streaming connection. An open
// connection keeps working after the token expires.
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(60); // one per wake word / follow-up window

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;

  const key = (process.env.DEEPGRAM_API_KEY || '').trim();
  if (!key) {
    sendJson(res, 503, { error: 'not_configured' });
    return;
  }

  try {
    const upstream = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      // No body: Deepgram's default lifetime (30 s) is what we want
      headers: { Authorization: `Token ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      // 400 "Invalid credentials" = bad key; 403 = the key's role is below Member (temporary
      // tokens need Member or higher). Either way the browser stops trying and uploads instead.
      // Deepgram's own message ("Insufficient permissions", "Invalid credentials") is safe to show
      // and says what to fix; the key itself is never included
      const detail = await upstream
        .json()
        .then((d) => String(d?.err_msg || d?.message || '').slice(0, 160))
        .catch(() => '');
      console.warn('[/api/stt-token] Deepgram grant HTTP', upstream.status, detail);
      const rejected = upstream.status === 400 || upstream.status === 401 || upstream.status === 403;
      sendJson(res, 502, { error: rejected ? 'token_rejected' : 'token_error', status: upstream.status, detail });
      return;
    }
    const data = await upstream.json();
    if (!data?.access_token) {
      sendJson(res, 502, { error: 'token_error' });
      return;
    }
    sendJson(res, 200, { token: data.access_token, expiresIn: Number(data.expires_in) || 30 });
  } catch (err) {
    console.warn('[/api/stt-token] failed:', err?.message || err);
    sendJson(res, 504, { error: 'token_unreachable' });
  }
}
