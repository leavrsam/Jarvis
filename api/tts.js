import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from 'msedge-tts';
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const ALLOWED_EDGE_VOICES = new Set([
  'en-GB-RyanNeural',
  'en-GB-ThomasNeural',
  'en-GB-SoniaNeural',
  'en-GB-LibbyNeural',
  'en-IE-ConnorNeural',
  'en-US-ChristopherNeural',
  'en-US-AndrewNeural',
]);

// Describes the character archetype rather than naming a real actor: voice design works from
// descriptions of vocal qualities, and prompts naming real people may be refused or ignored.
const DEFAULT_JARVIS_VOICE_PROMPT =
  'A refined English gentleman AI butler in his late 30s: light, clear baritone, crisp Received Pronunciation with precise, slightly clipped consonants, quick but unhurried delivery, soft-spoken and close to the microphone, unflappable calm with a faint undercurrent of dry amusement.';

const DEFAULT_JARVIS_STYLE =
  'Calm, understated and precise. Quick, even pacing with brief natural pauses. Soft-spoken and close, never theatrical or upbeat. A faint, dry, amused politeness, as if addressing someone he knows very well.';

// Server-side in-memory cache for the project's custom designed Jarvis voice ID
let cachedDesignedVoiceId = 'voice_5r8hqutci8lm';
const ttsMemoryCache = new Map();

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function createDesignedVoice(ai, prompt, baseVoice) {
  const prompted = { input: prompt };
  if (baseVoice) prompted.base_voice = baseVoice;
  const created = await ai.voices.create({
    store: true,
    voice: {
      model: 'gemini-3.8-flash-tts',
      type: 'prompted',
      display_name: `J.A.R.V.I.S. Mk-VII ${new Date().toISOString().slice(0, 16)}`,
      gender: 'male',
      language_code: 'en-GB',
      prompted,
    },
  });
  if (!created?.id) throw new Error('Voice Design returned no voice id');
  return { voiceId: created.id, sampleAudio: created.sample_audio?.data || null };
}

async function resolveOrCreateDesignedJarvisVoice(ai, customPrompt, baseVoice) {
  // Explicit design/remix request from the Voice Lab: surface errors instead of silently swapping voices
  if (customPrompt) {
    const result = await createDesignedVoice(ai, customPrompt, baseVoice);
    cachedDesignedVoiceId = result.voiceId;
    return result;
  }

  if (cachedDesignedVoiceId) {
    return { voiceId: cachedDesignedVoiceId, sampleAudio: null };
  }

  try {
    const listRes = await ai.voices.list({
      type: ['prompted'],
      search: 'J.A.R.V.I.S. Mk-VII',
      page_size: 10,
    });
    const existing = listRes?.voices?.find(
      (v) => v.display_name?.startsWith('J.A.R.V.I.S. Mk-VII') && v.id
    );
    if (existing?.id) {
      cachedDesignedVoiceId = existing.id;
      return { voiceId: existing.id, sampleAudio: null };
    }

    const created = await createDesignedVoice(ai, DEFAULT_JARVIS_VOICE_PROMPT);
    cachedDesignedVoiceId = created.voiceId;
    return created;
  } catch (err) {
    console.warn('[/api/tts] Voice Design lookup/create fallback:', err?.message || err);
    try {
      // Fallback 1: Query Extended Voice Library for a native British (en-GB) male voice
      const gbPrebuilt = await ai.voices.list({
        language_code: ['en-GB'],
        gender: ['male'],
        type: ['prebuilt'],
        page_size: 10,
      });
      const britishVoice = gbPrebuilt?.voices?.[0];
      if (britishVoice?.id) {
        cachedDesignedVoiceId = britishVoice.id;
        return { voiceId: britishVoice.id, sampleAudio: null };
      }
    } catch {}
  }

  return { voiceId: 'Charon', sampleAudio: null };
}

async function synthesizeWithGemini(apiKey, params, timeoutMs = 15000) {
  const ai = new GoogleGenAI({ apiKey });

  if (params.action === 'design_voice') {
    const prompt = (params.prompt || '').toString().trim().slice(0, 1000);
    const baseVoice = (params.baseVoice || '').toString().trim() || undefined;
    const result = await resolveOrCreateDesignedJarvisVoice(ai, prompt || DEFAULT_JARVIS_VOICE_PROMPT, baseVoice);
    return {
      isJson: true,
      payload: {
        voiceId: result.voiceId,
        sampleAudioBase64: result.sampleAudio,
      },
    };
  }

  const rawText = (params.text || '').toString().trim();
  const model =
    params.model === 'gemini-3.8-flash-lite-tts'
      ? 'gemini-3.8-flash-lite-tts'
      : 'gemini-3.8-flash-tts';

  let voiceId = (params.voice || 'AUTO_DESIGN_JARVIS').toString().trim();
  if (voiceId === 'AUTO_DESIGN_JARVIS') {
    const resolved = await resolveOrCreateDesignedJarvisVoice(ai);
    voiceId = resolved.voiceId;
  }

  const style = (params.style || DEFAULT_JARVIS_STYLE).toString().trim();

  let base64Audio = null;
  let contentType = 'audio/wav';
  // Timing breakdown for diagnostics (returned to the client as X-TTS-Path)
  const pathStart = Date.now();
  let path = '';

  try {
    const interaction = await ai.interactions.create({
      model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: rawText.slice(0, 2500),
              annotations: [
                {
                  type: 'speech_metadata',
                  style,
                },
              ],
            },
          ],
        },
      ],
      response_format: {
        type: 'audio',
      },
      generation_config: {
        speech_config: [{ voice: voiceId }],
      },
    }, {
      // The SDK otherwise silently retries 429/5xx up to 4 times over ~30s, which shows up as
      // mysterious slowness and keeps hammering the rate limit. Fail fast and report instead;
      // the timeout also cancels the underlying request rather than leaving it running.
      retries: { strategy: 'none' },
      timeout_ms: timeoutMs,
    });

    base64Audio = interaction?.output_audio?.data;
    contentType = interaction?.output_audio?.mime_type || 'audio/wav';
    path = `interactions ${Date.now() - pathStart}ms`;
  } catch (interactionErr) {
    const failedAfter = Date.now() - pathStart;
    const status = Number(interactionErr?.status || interactionErr?.statusCode || interactionErr?.code) || 0;
    const reason = String(interactionErr?.message || interactionErr).replace(/[\r\n]+/g, ' ').slice(0, 80);
    // Rate limits, overload and timeouts won't be fixed by a second API; retrying would double the load.
    if (status === 429 || status >= 500 || /timed? ?out|abort/i.test(reason)) {
      const err = new Error(`${status === 429 ? 'Rate limited (429)' : status ? `HTTP ${status}` : 'Timed out'} after ${failedAfter}ms: ${reason}`);
      err.status = status || 504;
      throw err;
    }
    console.warn('[/api/tts] Interactions API synthesis fallback:', reason);
    const fallbackStart = Date.now();

    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: rawText.slice(0, 2500),
              speechMetadata: { style },
            },
          ],
        },
      ],
      config: {
        abortSignal: AbortSignal.timeout(Math.max(1000, timeoutMs - failedAfter)),
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            voice: voiceId,
          },
        },
      },
    });

    const part = res?.candidates?.[0]?.content?.parts?.[0];
    base64Audio = part?.inlineData?.data;
    contentType = part?.inlineData?.mimeType || 'audio/wav';
    path = `interactions failed after ${failedAfter}ms (${reason}), generateContent ${Date.now() - fallbackStart}ms`;
  }

  if (!base64Audio) {
    throw new Error('Gemini 3.8 TTS returned no audio data');
  }

  return {
    isJson: false,
    buffer: Buffer.from(base64Audio, 'base64'),
    contentType,
    engine: model,
    voiceId,
    path,
  };
}

/**
 * Streaming Gemini TTS: yields raw 24 kHz 16-bit mono PCM chunks as Gemini generates them
 * (interactions.create with stream: true -> step.delta events with audio deltas).
 */
async function* streamGeminiAudio(apiKey, params) {
  const ai = new GoogleGenAI({ apiKey });
  const rawText = (params.text || '').toString().trim();
  const model =
    params.model === 'gemini-3.8-flash-lite-tts' ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-tts';
  let voiceId = (params.voice || 'AUTO_DESIGN_JARVIS').toString().trim();
  if (voiceId === 'AUTO_DESIGN_JARVIS') {
    voiceId = (await resolveOrCreateDesignedJarvisVoice(ai)).voiceId;
  }
  const style = (params.style || DEFAULT_JARVIS_STYLE).toString().trim();

  const stream = await ai.interactions.create(
    {
      model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: rawText.slice(0, 2500),
              annotations: [{ type: 'speech_metadata', style }],
            },
          ],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: voiceId }] },
      stream: true,
    },
    // No silent SDK retries (see synthesizeWithGemini); generous overall bound for long replies
    { retries: { strategy: 'none' }, timeout_ms: 60000 }
  );

  for await (const event of stream) {
    if (event?.event_type === 'step.delta' && event.delta?.type === 'audio' && event.delta.data) {
      yield Buffer.from(event.delta.data, 'base64');
    }
  }
}

async function synthesizeWithEdgeFallback(params) {
  // Gemini understands inline tags like <short pause>; Edge would read them aloud, so turn them into pauses
  const rawText = (params.text || '')
    .toString()
    .replace(/<[^>]{1,40}>/g, ', ')
    .replace(/\s*,\s*([,.!?])/g, '$1')
    .replace(/([.!?])\s*,/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const requestedVoice = (params.edgeVoice || params.voice || 'en-GB-RyanNeural').toString().trim();
  const voice = ALLOWED_EDGE_VOICES.has(requestedVoice) ? requestedVoice : 'en-GB-RyanNeural';
  const rate = (params.rate || '+4%').toString().trim();
  const pitch = (params.pitch || '-2Hz').toString().trim();

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const prosody = new ProsodyOptions();
    prosody.rate = rate;
    prosody.pitch = pitch;
    prosody.volume = '+0%';

    const { audioStream } = tts.toStream(escapeXml(rawText.slice(0, 2500)), prosody);

    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      audioStream.on('end', () => resolve());
      audioStream.on('close', () => resolve());
      audioStream.on('error', (err) => reject(err));
    });

    const audioBuffer = Buffer.concat(chunks);
    if (audioBuffer.length === 0) {
      throw new Error('Empty audio stream from Edge fallback');
    }

    return {
      buffer: audioBuffer,
      contentType: 'audio/mpeg',
      engine: 'edge-neural-fallback',
      voiceId: voice,
    };
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

// Only this app may use the endpoint (it spends the server's Gemini quota and money):
// same-origin requests only, and at most 60 per IP per minute. A normal reply uses ~2-3.
const ttsLimiter = createRateLimiter(60);

export default async function handler(req, res) {
  // No CORS headers: other sites' pages can't call this. (Previously Access-Control-Allow-Origin: *)
  if (!guardRequest(req, res, ttsLimiter)) return;
  // Logged-in HUD session required (see api/auth.js)
  if (!requireSession(req, res)) return;

  try {
    const params = req.method === 'POST' ? req.body || {} : req.query || {};
    const headerApiKey = (req.headers['x-gemini-api-key'] || '').toString().trim();
    const envApiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      ''
    ).trim();
    const apiKey = headerApiKey || envApiKey;

    if (params.action === 'status') {
      res.status(200).json({
        geminiConfigured: Boolean(apiKey),
        cachedDesignedVoiceId,
      });
      return;
    }

    if (params.action === 'design_voice') {
      if (!apiKey) {
        res.status(400).json({ error: 'Missing GEMINI_API_KEY for Voice Design' });
        return;
      }
      const result = await synthesizeWithGemini(apiKey, params);
      res.status(200).json(result.payload);
      return;
    }

    const rawText = (params.text || '').toString().trim();
    if (!rawText) {
      res.status(400).json({ error: 'Missing text parameter' });
      return;
    }

    const preferProvider = (params.provider || 'gemini').toString().trim();
    const wantsStream = params.stream === true || params.stream === 'true';
    const cacheKey = `${wantsStream ? 'stream' : 'unary'}::${preferProvider}::${params.model || ''}::${params.voice || 'default'}::${params.style || ''}::${rawText}`;
    const cached = ttsMemoryCache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', String(cached.buffer.length));
      res.setHeader('X-TTS-Engine', cached.engine);
      res.setHeader('X-Gemini-Voice-Id', cached.voiceId);
      res.setHeader('X-Cache-Hit', 'HIT');
      if (/l16/i.test(cached.contentType)) {
        res.setHeader('X-TTS-Format', 'pcm16');
        res.setHeader('X-TTS-Sample-Rate', '24000');
      }
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.status(200).send(cached.buffer);
      return;
    }

    // fallback: false = the client wants to handle Gemini failures itself (retry, or choose Edge)
    // rather than receiving a different voice silently mid-reply.
    const allowEdgeFallback = params.fallback !== false && params.fallback !== 'false';
    const geminiTimeoutMs = Math.min(25000, Math.max(3000, Number(params.geminiTimeoutMs) || 15000));
    const startedAt = Date.now();
    let geminiError = '';

    // Streaming: audio is forwarded to the browser chunk by chunk, so playback can start at the
    // first chunk. Errors before the first chunk are reported normally (the client falls back).
    if (wantsStream && apiKey && preferProvider !== 'edge') {
      const iterator = streamGeminiAudio(apiKey, params)[Symbol.asyncIterator]();
      let first;
      try {
        let firstTimer;
        first = await Promise.race([
          iterator.next(),
          new Promise((_, reject) => {
            firstTimer = setTimeout(
              () => reject(new Error(`Gemini TTS stream produced no audio within ${geminiTimeoutMs}ms`)),
              geminiTimeoutMs
            );
          }),
        ]).finally(() => clearTimeout(firstTimer));
        if (first.done) throw new Error('Gemini TTS stream ended without audio');
      } catch (streamErr) {
        iterator.return?.().catch(() => {});
        const msg = String(streamErr?.message || streamErr).replace(/[\r\n]+/g, ' ').slice(0, 200);
        const status = Number(streamErr?.status) === 429 ? 429 : /no audio within|timed? ?out/i.test(msg) ? 504 : 503;
        console.warn('[/api/tts] Gemini streaming failed:', msg);
        res.setHeader('X-TTS-Error', msg.replace(/[^\x20-\x7E]/g, ''));
        res.setHeader('X-TTS-Duration-Ms', String(Date.now() - startedAt));
        res.status(status).json({ error: 'gemini_failed', details: msg });
        return;
      }

      const model =
        params.model === 'gemini-3.8-flash-lite-tts' ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-tts';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/L16;rate=24000;channels=1');
      res.setHeader('X-TTS-Format', 'pcm16');
      res.setHeader('X-TTS-Sample-Rate', '24000');
      res.setHeader('X-TTS-Engine', model);
      res.setHeader('X-TTS-First-Audio-Ms', String(Date.now() - startedAt));
      res.setHeader('Cache-Control', 'no-store');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const parts = [first.value];
      res.write(first.value);
      try {
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          parts.push(next.value);
          res.write(next.value);
        }
      } catch (midErr) {
        // Headers are already sent; end the audio here and let the client play what arrived
        console.warn('[/api/tts] Gemini stream interrupted:', midErr?.message || midErr);
        res.end();
        return;
      }
      res.end();

      const buffer = Buffer.concat(parts);
      if (ttsMemoryCache.size > 60) {
        const oldest = ttsMemoryCache.keys().next().value;
        if (oldest) ttsMemoryCache.delete(oldest);
      }
      ttsMemoryCache.set(cacheKey, {
        buffer,
        contentType: 'audio/L16;rate=24000;channels=1',
        engine: model,
        voiceId: (params.voice || '').toString(),
      });
      return;
    }

    if (apiKey && preferProvider !== 'edge') {
      try {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Gemini TTS timed out after ${geminiTimeoutMs}ms`)),
            geminiTimeoutMs
          );
        });
        const result = await Promise.race([
          synthesizeWithGemini(apiKey, params, geminiTimeoutMs),
          timeoutPromise,
        ]).finally(() => clearTimeout(timeoutHandle));

        if (ttsMemoryCache.size > 60) {
          const oldest = ttsMemoryCache.keys().next().value;
          if (oldest) ttsMemoryCache.delete(oldest);
        }
        ttsMemoryCache.set(cacheKey, result);

        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', String(result.buffer.length));
        res.setHeader('X-TTS-Engine', result.engine);
        res.setHeader('X-Gemini-Voice-Id', result.voiceId);
        res.setHeader('X-TTS-Duration-Ms', String(Date.now() - startedAt));
        if (result.path) res.setHeader('X-TTS-Path', result.path.replace(/[^\x20-\x7E]/g, ''));
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.status(200).send(result.buffer);
        return;
      } catch (geminiErr) {
        geminiError = String(geminiErr?.message || geminiErr)
          .replace(/[\r\n]+/g, ' ')
          .slice(0, 200);
        console.warn('[/api/tts] Gemini TTS failed:', geminiError);
        if (!allowEdgeFallback) {
          const status = geminiErr?.status === 429 ? 429 : /timed out/i.test(geminiError) ? 504 : 503;
          res.setHeader('X-TTS-Error', geminiError.replace(/[^\x20-\x7E]/g, ''));
          res.setHeader('X-TTS-Duration-Ms', String(Date.now() - startedAt));
          res.status(status).json({ error: 'gemini_failed', details: geminiError });
          return;
        }
      }
    }

    // Free Fallback to 24kHz Edge Neural TTS (~300ms) when no Gemini API key is configured
    const edgeResult = await synthesizeWithEdgeFallback(params);

    // Only cache Edge audio when Edge was the intended voice. If Gemini merely timed out,
    // don't lock the fallback voice in for this phrase; let Gemini try again next time.
    const edgeWasIntended = !apiKey || preferProvider === 'edge';
    if (edgeWasIntended) {
      if (ttsMemoryCache.size > 60) {
        const oldest = ttsMemoryCache.keys().next().value;
        if (oldest) ttsMemoryCache.delete(oldest);
      }
      ttsMemoryCache.set(cacheKey, edgeResult);
    }

    res.setHeader('Content-Type', edgeResult.contentType);
    res.setHeader('Content-Length', String(edgeResult.buffer.length));
    res.setHeader('X-TTS-Engine', edgeResult.engine);
    res.setHeader('X-Gemini-Voice-Id', edgeResult.voiceId);
    res.setHeader('X-TTS-Duration-Ms', String(Date.now() - startedAt));
    if (geminiError) res.setHeader('X-TTS-Error', geminiError.replace(/[^\x20-\x7E]/g, ''));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(edgeResult.buffer);
  } catch (err) {
    console.error('[/api/tts] Fatal synthesis error:', err);
    res.status(500).json({
      error: 'Speech synthesis failed',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
