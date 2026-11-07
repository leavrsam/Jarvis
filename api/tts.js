import { GoogleGenAI } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from 'msedge-tts';

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

async function synthesizeWithGemini(apiKey, params) {
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
    });

    base64Audio = interaction?.output_audio?.data;
    contentType = interaction?.output_audio?.mime_type || 'audio/wav';
    path = `interactions ${Date.now() - pathStart}ms`;
  } catch (interactionErr) {
    const failedAfter = Date.now() - pathStart;
    const reason = String(interactionErr?.message || interactionErr).replace(/[\r\n]+/g, ' ').slice(0, 80);
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-api-key');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-TTS-Engine, X-Gemini-Voice-Id, X-TTS-Duration-Ms, X-TTS-Error, X-TTS-Path'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

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
    const cacheKey = `${preferProvider}::${params.model || ''}::${params.voice || 'default'}::${params.style || ''}::${rawText}`;
    const cached = ttsMemoryCache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', String(cached.buffer.length));
      res.setHeader('X-TTS-Engine', cached.engine);
      res.setHeader('X-Gemini-Voice-Id', cached.voiceId);
      res.setHeader('X-Cache-Hit', 'HIT');
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
          synthesizeWithGemini(apiKey, params),
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
          res.setHeader('X-TTS-Error', geminiError.replace(/[^\x20-\x7E]/g, ''));
          res.setHeader('X-TTS-Duration-Ms', String(Date.now() - startedAt));
          res.status(503).json({ error: 'gemini_failed', details: geminiError });
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
