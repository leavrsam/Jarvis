// Voice comparison lab: one adapter per TTS provider, all server-side.
// API keys are read from environment variables only; they are never sent to the browser.
// This endpoint is independent of the live voice pipeline (api/tts.js) and does not change it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const MAX_TEXT_CHARS = 400;
const SAMPLE_RATE = 24000;

const OPENAI_INSTRUCTIONS = 'Speak as a composed, dry-witted British butler. Calm, precise, understated.';
const DEFAULT_GEMINI_VOICE = 'voice_5r8hqutci8lm';
const DEFAULT_GEMINI_STYLE = 'calm, precise, dryly understated';

// ---------------------------------------------------------------------------
// Voice catalogue. Prices are list prices (USD) as of Nov 2026; see README.
// ---------------------------------------------------------------------------
const googleVoices = (process.env.VOICE_LAB_GOOGLE_VOICES || 'Iapetus,Algieba')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
  .slice(0, 4);

export const VOICES = [
  ...googleVoices.map((name) => ({
    id: `google-${name.toLowerCase()}`,
    provider: 'google',
    providerName: 'Google Cloud TTS (Chirp 3 HD)',
    voiceName: `en-GB-Chirp3-HD-${name}`,
    accent: 'British English, male',
    streaming: false,
    streamNote: 'Not streamed here: Chirp 3 HD streams only over gRPC; this uses the REST API.',
    priceText: '$30 / 1M characters (1M free/month)',
    costPerChar: 30 / 1e6,
  })),
  {
    id: 'azure-ryan',
    provider: 'azure',
    providerName: 'Azure Speech',
    voiceName: 'en-GB-RyanNeural',
    accent: 'British English, male',
    streaming: true,
    streamNote: 'Streams raw PCM over HTTP as it is synthesized.',
    priceText: '$15 / 1M characters (F0: 0.5M free/month)',
    costPerChar: 15 / 1e6,
  },
  {
    id: 'azure-thomas',
    provider: 'azure',
    providerName: 'Azure Speech',
    voiceName: 'en-GB-ThomasNeural',
    accent: 'British English, male',
    streaming: true,
    streamNote: 'Streams raw PCM over HTTP as it is synthesized.',
    priceText: '$15 / 1M characters (F0: 0.5M free/month)',
    costPerChar: 15 / 1e6,
  },
  {
    id: 'openai-cedar',
    provider: 'openai',
    providerName: 'OpenAI gpt-4o-mini-tts',
    voiceName: 'cedar',
    accent: 'Steered British via instructions',
    streaming: true,
    streamNote: 'Streams raw PCM over HTTP as it is generated.',
    priceText: '~$0.015 / minute of audio ($12 / 1M audio tokens)',
    costPerSecond: 0.015 / 60,
  },
  {
    id: 'openai-ash',
    provider: 'openai',
    providerName: 'OpenAI gpt-4o-mini-tts',
    voiceName: 'ash',
    accent: 'Steered British via instructions',
    streaming: true,
    streamNote: 'Streams raw PCM over HTTP as it is generated.',
    priceText: '~$0.015 / minute of audio ($12 / 1M audio tokens)',
    costPerSecond: 0.015 / 60,
  },
  {
    id: 'deepgram-draco',
    provider: 'deepgram',
    providerName: 'Deepgram Aura-2',
    voiceName: 'aura-2-draco-en',
    accent: 'British English, male (the only UK male Aura-2 voice)',
    streaming: true,
    streamNote: 'Streams raw PCM over HTTP as it is generated.',
    priceText: '$0.030 / 1K characters ($200 free credit)',
    costPerChar: 0.03 / 1000,
    // Aura-2 has no style control; speed is the only delivery knob
    tunable: { speedMin: 0.7, speedMax: 1.5, expressivity: false },
  },
  // Deepgram Flux TTS: Deepgram's newer model, with eight British voices (seven male),
  // plus speed, an "expressivity" (calm <-> animated) dial and native pause markers.
  {
    id: 'flux-jack',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-jack-en',
    accent: 'British English, male: clear, professional, thoughtful',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-tanner',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-tanner-en',
    accent: 'British English, male: calm, confident, professional',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-colin',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-colin-en',
    accent: 'British English, male: warm, reassuring, authoritative',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-rufus',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-rufus-en',
    accent: 'British English, male: intelligent, gentle delivery',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-kit',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-kit-en',
    accent: 'British English, male, young adult: upbeat, calm, helpful',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-sean',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-sean-en',
    accent: 'British English, male, mature: gentle, soothing',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'flux-conor',
    provider: 'deepgram-flux',
    providerName: 'Deepgram Flux TTS',
    voiceName: 'flux-conor-en',
    accent: 'British English, male, mature: deep, relaxed, friendly',
    streaming: false,
    streamNote: 'Not streamed here: Flux streams only over WebSocket; this uses the batch REST API.',
    priceText: '$0.045 / 1K characters (uses the $200 credit)',
    costPerChar: 0.045 / 1000,
    tunable: { speedMin: 0.5, speedMax: 1.5, expressivity: true },
  },
  {
    id: 'edge-ryan',
    provider: 'edge',
    providerName: 'Microsoft Edge TTS (current fallback)',
    voiceName: 'en-GB-RyanNeural',
    accent: 'British English, male',
    streaming: true,
    streamNote: 'Streams MP3 chunks as they are synthesized.',
    priceText: 'Free (unofficial endpoint, no SLA)',
    costPerChar: 0,
  },
  {
    id: 'gemini-current',
    provider: 'gemini',
    providerName: 'Gemini 3.8 Flash TTS (current voice)',
    voiceName: 'Your designed Jarvis voice',
    accent: 'Designed British voice',
    streaming: false,
    streamNote: 'Not streamed (the live pipeline does not stream Gemini either).',
    priceText: '$9 / 1M audio tokens (~$0.0135 / minute)',
    // 25 audio tokens per second of speech
    costPerSecond: (25 * 9) / 1e6,
  },
];

const ENV_REQUIREMENTS = {
  google: ['GOOGLE_TTS_API_KEY'],
  azure: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'],
  openai: ['OPENAI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  'deepgram-flux': ['DEEPGRAM_API_KEY'],
  edge: [],
  gemini: ['GEMINI_API_KEY'],
};

function geminiKey(req) {
  // The env key is preferred. The header is only the key the user already saved in this
  // browser for the live app (the server never sends any key to the browser).
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    (req.headers['x-gemini-api-key'] || '').toString().trim()
  );
}

function isConfigured(provider, req) {
  if (provider === 'gemini') return Boolean(geminiKey(req));
  return ENV_REQUIREMENTS[provider].every((name) => Boolean((process.env[name] || '').trim()));
}

// ---------------------------------------------------------------------------
// Text preparation: same "<short pause>" handling as the live pipeline (api/tts.js):
// Gemini understands inline tags and receives them as-is; every other engine would read
// them aloud, so they become a comma pause. Mirrors synthesizeWithEdgeFallback.
// ---------------------------------------------------------------------------
export function textForEngine(text, provider, tuning) {
  if (provider === 'gemini') return text;
  // Flux TTS has native pause markers (max 8; only allowed with speed <= 1.15), which are the
  // closest equivalent to Gemini's tags. Otherwise fall through to the live pipeline's comma pause.
  if (provider === 'deepgram-flux' && (!tuning || tuning.speed <= 1.15)) {
    let count = 0;
    text = text.replace(/<(short|long)? ?pause>/gi, (_m, kind) =>
      ++count <= 8 ? (kind?.toLowerCase() === 'long' ? ' \\{pause:1s\\} ' : ' \\{pause:500ms\\} ') : ', '
    );
  }
  return text
    .replace(/<[^>]{1,40}>/g, ', ')
    .replace(/\s*,\s*([,.!?])/g, '$1')
    .replace(/([.!?])\s*,/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Provider error messages can echo the API key back (OpenAI does: "Incorrect API key provided:
// sk-..."). Strip every configured secret, plus anything key-shaped, before it reaches a browser or log.
const SECRET_ENV_NAMES = ['GOOGLE_TTS_API_KEY', 'AZURE_SPEECH_KEY', 'OPENAI_API_KEY', 'DEEPGRAM_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];

function redact(message, extraSecrets = []) {
  let out = String(message);
  const secrets = [...SECRET_ENV_NAMES.map((n) => (process.env[n] || '').trim()), ...extraSecrets]
    .filter((v) => v && v.length >= 6)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out
    .replace(/\b(sk|rk)-[A-Za-z0-9_*-]{6,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, '[redacted]');
}

async function upstreamError(response, provider) {
  const body = await response.text().catch(() => '');
  const detail = redact(body.replace(/\s+/g, ' ')).slice(0, 240);
  const err = new Error(`${provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  err.status = response.status;
  return err;
}

async function* iterateBody(response) {
  for await (const chunk of response.body) {
    yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  }
}

// ---------------------------------------------------------------------------
// Adapters. Each returns { format: 'pcm16' | 'mp3' | 'wav', sampleRate?, chunks: AsyncIterable }
// ---------------------------------------------------------------------------
const adapters = {
  async google(voice, text) {
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_TTS_API_KEY,
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-GB', name: voice.voiceName },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
      }),
    });
    if (!response.ok) throw await upstreamError(response, 'Google Cloud TTS');
    const json = await response.json();
    const audio = Buffer.from(json.audioContent || '', 'base64');
    // LINEAR16 from the REST API includes a WAV header
    return { format: 'wav', chunks: [new Uint8Array(audio)] };
  },

  async azure(voice, text) {
    const region = process.env.AZURE_SPEECH_REGION.trim();
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB">` +
      `<voice name="${voice.voiceName}">${escapeXml(text)}</voice></speak>`;
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
        'User-Agent': 'jarvis-voice-lab',
      },
      body: ssml,
    });
    if (!response.ok) throw await upstreamError(response, 'Azure Speech');
    return { format: 'pcm16', sampleRate: SAMPLE_RATE, chunks: iterateBody(response) };
  },

  async openai(voice, text) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: voice.voiceName,
        input: text,
        instructions: OPENAI_INSTRUCTIONS,
        response_format: 'pcm', // 24 kHz, 16-bit signed little-endian, mono
      }),
    });
    if (!response.ok) throw await upstreamError(response, 'OpenAI');
    return { format: 'pcm16', sampleRate: SAMPLE_RATE, chunks: iterateBody(response) };
  },

  async deepgram(voice, text, ctx) {
    const params = new URLSearchParams({
      model: voice.voiceName,
      encoding: 'linear16',
      sample_rate: String(SAMPLE_RATE),
      container: 'none',
    });
    if (ctx.tuning && ctx.tuning.speed !== 1) params.set('speed', String(ctx.tuning.speed));
    const response = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw await upstreamError(response, 'Deepgram');
    return { format: 'pcm16', sampleRate: SAMPLE_RATE, chunks: iterateBody(response) };
  },

  async 'deepgram-flux'(voice, text, ctx) {
    const params = new URLSearchParams({
      model: voice.voiceName,
      encoding: 'linear16',
      sample_rate: String(SAMPLE_RATE),
      container: 'wav',
    });
    if (ctx.tuning) {
      if (ctx.tuning.speed !== 1) params.set('speed', String(ctx.tuning.speed));
      if (ctx.tuning.expressivity !== 0) params.set('expressivity', String(ctx.tuning.expressivity));
    }
    const response = await fetch(`https://api.deepgram.com/v2/speak?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw await upstreamError(response, 'Deepgram Flux');
    return { format: 'wav', chunks: [new Uint8Array(await response.arrayBuffer())] };
  },

  async edge(voice, text) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice.voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text));
    async function* chunks() {
      try {
        for await (const chunk of audioStream) yield new Uint8Array(chunk);
      } finally {
        try {
          tts.close();
        } catch {}
      }
    }
    return { format: 'mp3', chunks: chunks() };
  },

  async gemini(voice, text, ctx) {
    const ai = new GoogleGenAI({ apiKey: ctx.geminiKey });
    const interaction = await ai.interactions.create(
      {
        model: 'gemini-3.8-flash-tts',
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text,
                annotations: [{ type: 'speech_metadata', style: ctx.geminiStyle }],
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: ctx.geminiVoice }] },
      },
      { retries: { strategy: 'none' }, timeout_ms: 25000 }
    );
    const data = interaction?.output_audio?.data;
    if (!data) throw new Error('Gemini returned no audio');
    const mime = (interaction?.output_audio?.mime_type || 'audio/wav').toLowerCase();
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    if (mime.includes('l16') || mime.includes('pcm')) {
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || SAMPLE_RATE;
      return { format: 'pcm16', sampleRate: rate, chunks: [bytes] };
    }
    return { format: mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'wav', chunks: [bytes] };
  },
};

// ---------------------------------------------------------------------------
// Cache: memory + files in the OS temp dir, so replays and page reloads cost nothing.
// (On Vercel the temp dir is per instance; the browser also caches every clip.)
// ---------------------------------------------------------------------------
const CACHE_DIR = path.join(os.tmpdir(), 'jarvis-voice-lab-cache');
const memoryCache = new Map();

function cacheKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
}

function readCache(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8'));
    const bytes = fs.readFileSync(path.join(CACHE_DIR, `${key}.bin`));
    const entry = { ...meta, bytes };
    memoryCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeCache(key, entry) {
  if (memoryCache.size > 200) memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, entry);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.bin`), entry.bytes);
    const { bytes, ...meta } = entry;
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(meta));
  } catch {}
}

// ---------------------------------------------------------------------------
// Access guard: same passcode as the HUD. It is a deterrent against drive-by use of your
// API keys, not strong auth (the HUD passcode ships in the client bundle).
// ---------------------------------------------------------------------------
function authorized(req) {
  const expected = (process.env.VITE_JARVIS_SECRET || process.env.JARVIS_SECRET || 'wolfcub').trim().toLowerCase();
  const given = (req.headers['x-jarvis-secret'] || '').toString().trim().toLowerCase();
  return given && given === expected;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function contentTypeFor(format, sampleRate) {
  if (format === 'pcm16') return `audio/L16;rate=${sampleRate};channels=1`;
  if (format === 'mp3') return 'audio/mpeg';
  return 'audio/wav';
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'Unlock the Jarvis HUD first (passcode required).' });
    return;
  }

  const params = req.method === 'POST' ? req.body || {} : req.query || {};

  if (params.action === 'providers' || req.method === 'GET') {
    sendJson(res, 200, {
      voices: VOICES.map(({ costPerChar, costPerSecond, ...v }) => ({
        ...v,
        costPerChar: costPerChar ?? null,
        costPerSecond: costPerSecond ?? null,
        configured: isConfigured(v.provider, req),
        envVars: v.provider === 'gemini' ? ['GEMINI_API_KEY'] : ENV_REQUIREMENTS[v.provider],
      })),
    });
    return;
  }

  const voice = VOICES.find((v) => v.id === params.voiceId);
  if (!voice) {
    sendJson(res, 400, { error: 'Unknown voiceId' });
    return;
  }
  if (!isConfigured(voice.provider, req)) {
    sendJson(res, 400, { error: `${voice.providerName} is not configured` });
    return;
  }
  const rawText = (params.text || '').toString().trim();
  if (!rawText || rawText.length > MAX_TEXT_CHARS) {
    sendJson(res, 400, { error: `Text must be 1-${MAX_TEXT_CHARS} characters` });
    return;
  }

  // Delivery tuning for voices that support it, clamped to each API's accepted values
  let tuning = null;
  if (voice.tunable) {
    const t = params.tuning || {};
    const speedRaw = Number(t.speed);
    const speed = Number.isFinite(speedRaw)
      ? Math.min(voice.tunable.speedMax, Math.max(voice.tunable.speedMin, Math.round(speedRaw * 20) / 20))
      : 1;
    const exprRaw = Math.round(Number(t.expressivity));
    const expressivity = voice.tunable.expressivity && Number.isFinite(exprRaw) ? Math.min(2, Math.max(-2, exprRaw)) : 0;
    tuning = { speed, expressivity };
  }

  const text = textForEngine(rawText, voice.provider, tuning);
  const ctx = {
    tuning,
    geminiKey: geminiKey(req),
    geminiVoice: (params.geminiVoice || DEFAULT_GEMINI_VOICE).toString().trim(),
    geminiStyle: (params.geminiStyle || DEFAULT_GEMINI_STYLE).toString().trim().slice(0, 300),
  };
  const key = cacheKey([
    voice.id,
    voice.voiceName,
    text,
    voice.provider === 'gemini' ? [ctx.geminiVoice, ctx.geminiStyle] : null,
    tuning,
  ]);

  // Cache hit: no provider call at all
  if (!params.regenerate) {
    const cached = readCache(key);
    if (cached) {
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(cached.format, cached.sampleRate));
      res.setHeader('X-Lab-Format', cached.format);
      res.setHeader('X-Lab-Sample-Rate', String(cached.sampleRate || SAMPLE_RATE));
      res.setHeader('X-Lab-Cache', 'HIT');
      res.setHeader('Cache-Control', 'no-store');
      res.end(Buffer.from(cached.bytes));
      return;
    }
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await adapters[voice.provider](voice, text, ctx);
  } catch (err) {
    const message = redact(String(err?.message || err), [ctx.geminiKey]).slice(0, 400);
    console.warn(`[/api/voice-lab] ${voice.id} failed:`, message);
    sendJson(res, err?.status && err.status < 600 ? 502 : 500, { error: message });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(result.format, result.sampleRate));
  res.setHeader('X-Lab-Format', result.format);
  res.setHeader('X-Lab-Sample-Rate', String(result.sampleRate || SAMPLE_RATE));
  res.setHeader('X-Lab-Cache', 'MISS');
  res.setHeader('X-Lab-Streamed', voice.streaming ? '1' : '0');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const collected = [];
  try {
    for await (const chunk of result.chunks) {
      collected.push(Buffer.from(chunk));
      res.write(Buffer.from(chunk));
    }
  } catch (err) {
    console.warn(`[/api/voice-lab] ${voice.id} stream error:`, redact(String(err?.message || err), [ctx.geminiKey]));
    res.end();
    return;
  }
  res.end();

  const bytes = Buffer.concat(collected);
  if (bytes.length > 256) {
    writeCache(key, {
      format: result.format,
      sampleRate: result.sampleRate || SAMPLE_RATE,
      bytes,
      generatedMs: Date.now() - startedAt,
    });
  }
}
