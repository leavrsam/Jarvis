// Speech-to-text for spoken commands (used by the built-in wake word listener).
// The browser posts the command audio (16 kHz mono WAV); this forwards it to Deepgram and returns
// the transcript. The Deepgram key stays server-side (DEEPGRAM_API_KEY).
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const MAX_BYTES = 1_500_000; // ~45 s of 16 kHz 16-bit mono
const limiter = createRateLimiter(40);

// Words Deepgram should favour (Nova-3 keyterm prompting)
const KEYTERMS = ['Jarvis', 'Motif', 'Antigravity'];

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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

  let audio;
  try {
    audio = await readBody(req);
  } catch (err) {
    sendJson(res, err?.status === 413 ? 413 : 400, { error: err?.status === 413 ? 'too_large' : 'bad_body' });
    return;
  }
  if (audio.length < 1000) {
    sendJson(res, 400, { error: 'no_audio' });
    return;
  }

  const params = new URLSearchParams({ model: 'nova-3', language: 'en', smart_format: 'true', punctuate: 'true' });
  for (const t of KEYTERMS) params.append('keyterm', t);
  const started = Date.now();
  try {
    const upstream = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: audio,
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.warn('[/api/transcribe] Deepgram HTTP', upstream.status);
      sendJson(res, 502, { error: upstream.status === 401 || upstream.status === 403 ? 'stt_rejected' : 'stt_error' });
      return;
    }
    const data = await upstream.json();
    const alt = data?.results?.channels?.[0]?.alternatives?.[0] || {};
    sendJson(res, 200, {
      transcript: (alt.transcript || '').trim(),
      confidence: alt.confidence ?? null,
      ms: Date.now() - started,
    });
  } catch (err) {
    console.warn('[/api/transcribe] failed:', err?.message || err);
    sendJson(res, 504, { error: 'stt_unreachable' });
  }
}
