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

const DEFAULT_JARVIS_VOICE_PROMPT =
  'A refined, articulate British gentleman butler in his early 40s with a warm, resonant baritone voice, speaking with calm, effortless composure, crisp Received Pronunciation diction, and natural human warmth.';

const DEFAULT_JARVIS_STYLE =
  'calm, composed, articulate British gentleman butler, warm resonant baritone, natural conversational pacing with subtle dry sophistication';

// Server-side in-memory cache for the project's custom designed Jarvis voice ID
let cachedDesignedVoiceId = 'voice_g67uthl21vr5';

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function resolveOrCreateDesignedJarvisVoice(ai, customPrompt) {
  if (cachedDesignedVoiceId && !customPrompt) {
    return { voiceId: cachedDesignedVoiceId, sampleAudio: null };
  }

  try {
    if (!customPrompt) {
      const listRes = await ai.voices.list({
        type: ['prompted'],
        search: 'J.A.R.V.I.S. Mk-VII',
        page_size: 10,
      });
      const existing = listRes?.voices?.find(
        (v) => v.display_name === 'J.A.R.V.I.S. Mk-VII' && v.id
      );
      if (existing?.id) {
        cachedDesignedVoiceId = existing.id;
        return { voiceId: existing.id, sampleAudio: null };
      }
    }

    const created = await ai.voices.create({
      store: true,
      voice: {
        model: 'gemini-3.8-flash-tts',
        type: 'prompted',
        display_name: 'J.A.R.V.I.S. Mk-VII',
        gender: 'male',
        language_code: 'en-GB',
        prompted: {
          input: customPrompt || DEFAULT_JARVIS_VOICE_PROMPT,
        },
      },
    });

    if (created?.id) {
      cachedDesignedVoiceId = created.id;
      return {
        voiceId: created.id,
        sampleAudio: created.sample_audio?.data || null,
      };
    }
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
    const result = await resolveOrCreateDesignedJarvisVoice(ai, params.prompt);
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

  const base64Audio = interaction?.output_audio?.data;
  if (!base64Audio) {
    throw new Error('Gemini 3.8 TTS returned no output_audio data');
  }

  return {
    isJson: false,
    buffer: Buffer.from(base64Audio, 'base64'),
    contentType: interaction?.output_audio?.mime_type || 'audio/wav',
    engine: model,
    voiceId,
  };
}

async function synthesizeWithEdgeFallback(params) {
  const rawText = (params.text || '').toString().trim();
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
  res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Engine, X-Gemini-Voice-Id');

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

    if (apiKey && preferProvider !== 'edge') {
      try {
        const result = await synthesizeWithGemini(apiKey, params);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', String(result.buffer.length));
        res.setHeader('X-TTS-Engine', result.engine);
        res.setHeader('X-Gemini-Voice-Id', result.voiceId);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.status(200).send(result.buffer);
        return;
      } catch (geminiErr) {
        console.warn('[/api/tts] Gemini TTS error, falling back to Edge Neural:', geminiErr?.message || geminiErr);
      }
    }

    // Fallback to 24kHz Edge Neural TTS
    const edgeResult = await synthesizeWithEdgeFallback(params);
    res.setHeader('Content-Type', edgeResult.contentType);
    res.setHeader('Content-Length', String(edgeResult.buffer.length));
    res.setHeader('X-TTS-Engine', edgeResult.engine);
    res.setHeader('X-Gemini-Voice-Id', edgeResult.voiceId);
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
