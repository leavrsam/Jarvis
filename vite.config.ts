import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import ttsHandler from './api/tts.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import voiceLabHandler from './api/voice-lab.js';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }
  if (env.VITE_GEMINI_API_KEY && !process.env.VITE_GEMINI_API_KEY) {
    process.env.VITE_GEMINI_API_KEY = env.VITE_GEMINI_API_KEY;
  }

  // Voice comparison lab provider keys (server-side only; never prefixed with VITE_)
  for (const name of [
    'GOOGLE_TTS_API_KEY',
    'AZURE_SPEECH_KEY',
    'AZURE_SPEECH_REGION',
    'OPENAI_API_KEY',
    'DEEPGRAM_API_KEY',
    'VOICE_LAB_GOOGLE_VOICES',
    'JARVIS_SECRET',
    'VITE_JARVIS_SECRET',
  ]) {
    if (env[name] && !process.env[name]) process.env[name] = env[name];
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // Dev server route for the voice comparison lab. Passes the real Node response through
        // so provider audio can stream to the browser exactly as it does on Vercel.
        name: 'jarvis-api-voice-lab-middleware',
        configureServer(server) {
          server.middlewares.use('/api/voice-lab', async (req, res) => {
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
            const labReq = req as typeof req & { body: unknown; query: Record<string, string> };
            labReq.query = Object.fromEntries(url.searchParams.entries());
            try {
              labReq.body = bodyData ? JSON.parse(bodyData) : {};
            } catch {
              labReq.body = {};
            }
            await voiceLabHandler(labReq, res);
          });
        },
      },
      {
        name: 'jarvis-api-tts-middleware',
        configureServer(server) {
          server.middlewares.use('/api/tts', async (req, res) => {
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
            const queryObj: Record<string, string> = {};
            url.searchParams.forEach((v, k) => {
              queryObj[k] = v;
            });

            const mockReq = {
              method: req.method,
              headers: req.headers,
              query: queryObj,
              body: bodyData ? JSON.parse(bodyData) : {},
            };

            const mockRes = {
              statusCode: 200,
              setHeader(k: string, v: string) {
                res.setHeader(k, v);
              },
              status(code: number) {
                this.statusCode = code;
                res.statusCode = code;
                return this;
              },
              json(obj: unknown) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(obj));
              },
              send(buf: Buffer | string) {
                res.end(buf);
              },
              end() {
                res.end();
              },
            };

            await ttsHandler(mockReq, mockRes);
          });
        },
      },
    ],
    server: {
      port: 5173,
      host: true,
    },
  };
});
