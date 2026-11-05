import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from 'msedge-tts';

function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'jarvis-edge-tts-middleware',
      configureServer(server) {
        server.middlewares.use('/api/tts', async (req, res) => {
          try {
            let bodyData = '';
            if (req.method === 'POST') {
              await new Promise<void>((resolve) => {
                req.on('data', (chunk) => {
                  bodyData += chunk.toString();
                });
                req.on('end', () => resolve());
              });
            }

            const url = new URL(req.url || '', 'http://localhost');
            const parsedBody = bodyData ? JSON.parse(bodyData) : {};
            const text = (parsedBody.text || url.searchParams.get('text') || '').trim();
            const voice = (parsedBody.voice || url.searchParams.get('voice') || 'en-GB-RyanNeural').trim();
            const rate = (parsedBody.rate || url.searchParams.get('rate') || '+4%').trim();
            const pitch = (parsedBody.pitch || url.searchParams.get('pitch') || '-2Hz').trim();

            if (!text) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing text' }));
              return;
            }

            const tts = new MsEdgeTTS();
            try {
              await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
              const prosody = new ProsodyOptions();
              prosody.rate = rate;
              prosody.pitch = pitch;
              const { audioStream } = tts.toStream(escapeXml(text), prosody);

              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                audioStream.on('data', (c) => chunks.push(Buffer.from(c)));
                audioStream.on('end', () => resolve());
                audioStream.on('close', () => resolve());
                audioStream.on('error', (e) => reject(e));
              });

              const buf = Buffer.concat(chunks);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Content-Length', String(buf.length));
              res.end(buf);
            } finally {
              try {
                tts.close();
              } catch {}
            }
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: true,
  },
});
