import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from 'msedge-tts';

const ALLOWED_VOICES = new Set([
  'en-GB-RyanNeural',
  'en-GB-ThomasNeural',
  'en-GB-SoniaNeural',
  'en-GB-LibbyNeural',
  'en-IE-ConnorNeural',
  'en-US-ChristopherNeural',
  'en-US-AndrewNeural',
  'en-US-BrianNeural',
  'en-AU-WilliamMultilingualNeural',
]);

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const rawText = (params.text || '').toString().trim();
    const requestedVoice = (params.voice || 'en-GB-RyanNeural').toString().trim();
    const rate = (params.rate || '+4%').toString().trim();
    const pitch = (params.pitch || '-2Hz').toString().trim();

    if (!rawText) {
      res.status(400).json({ error: 'Missing text parameter' });
      return;
    }

    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : 'en-GB-RyanNeural';
    const safeText = escapeXml(rawText.slice(0, 2500));

    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

      const prosody = new ProsodyOptions();
      prosody.rate = rate;
      prosody.pitch = pitch;
      prosody.volume = '+0%';

      const { audioStream } = tts.toStream(safeText, prosody);

      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        audioStream.on('end', () => resolve());
        audioStream.on('close', () => resolve());
        audioStream.on('error', (err) => reject(err));
      });

      const audioBuffer = Buffer.concat(chunks);
      if (audioBuffer.length === 0) {
        throw new Error('Empty audio stream returned from neural synthesizer');
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(audioBuffer.length));
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.status(200).send(audioBuffer);
    } finally {
      try {
        tts.close();
      } catch {}
    }
  } catch (err) {
    console.error('[/api/tts] Synthesis error:', err);
    res.status(500).json({
      error: 'Neural TTS synthesis failed',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
