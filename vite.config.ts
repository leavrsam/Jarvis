import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import ttsHandler from './api/tts.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import voiceLabHandler from './api/voice-lab.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import jarvisCommandHandler from './api/jarvis-command.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import authHandler from './api/auth.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import transcribeHandler from './api/transcribe.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import cameraHandler from './api/camera.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import sttTokenHandler from './api/stt-token.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import imageSearchHandler from './api/image-search.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import calendarHandler from './api/calendar.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import feedHandler from './api/feed.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import newsHandler from './api/news.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import marketsHandler from './api/markets.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import sportsHandler from './api/sports.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import commuteHandler from './api/commute.js';
// @ts-expect-error - Vercel serverless handler is plain ESM JS
import pushHandler from './api/push.js';

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
    'JARVIS_WEBHOOK_URL',
    'JARVIS_WEBHOOK_SECRET',
    'JARVIS_MEDIA_URL',
    'JARVIS_CALENDAR_URL',
    'JARVIS_FEEDS_URL',
    'JARVIS_FEED_SHOPPING_URL',
    'JARVIS_FEED_TASKS_URL',
    'JARVIS_FEED_HOME_URL',
    'JARVIS_FEED_DELIVERIES_URL',
    'JARVIS_FEED_DOORBELL_URL',
    'JARVIS_FEED_PHOTOS_URL',
    'GOOGLE_MAPS_API_KEY',
    'JARVIS_ALLOWED_ORIGINS',
    'JARVIS_LOGIN_PASSWORD',
    'JARVIS_SESSION_SECRET',
    'JARVIS_NOTIFY_SECRET',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ]) {
    if (env[name] && !process.env[name]) process.env[name] = env[name];
  }

  // Short build id (the deployed commit on Vercel), shown in the VOICE ID panel
  const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);

  return {
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        // Dev route for the n8n proxy: the real request/response are passed through untouched so
        // the body is forwarded byte for byte and the reply streams like on Vercel.
        name: 'jarvis-api-command-middleware',
        configureServer(server) {
          server.middlewares.use('/api/jarvis-command', (req, res) => {
            void jarvisCommandHandler(req, res);
          });
          // Login / logout / session status
          server.middlewares.use('/api/auth', (req, res) => {
            void authHandler(req, res);
          });
          // Speech-to-text for the built-in listener
          server.middlewares.use('/api/transcribe', (req, res) => {
            void transcribeHandler(req, res);
          });
          // Camera snapshots for the HUD screen
          server.middlewares.use('/api/camera', (req, res) => {
            void cameraHandler(req, res);
          });
          // Short-lived Deepgram token for live transcription
          server.middlewares.use('/api/stt-token', (req, res) => {
            void sttTokenHandler(req, res);
          });
          // Image search for SHOW_IMAGE_SEARCH
          server.middlewares.use('/api/image-search', (req, res) => {
            void imageSearchHandler(req, res);
          });
          // Calendar events for the HUD
          server.middlewares.use('/api/calendar', (req, res) => {
            void calendarHandler(req, res);
          });
          // Widget data: n8n feeds, headlines, markets, sports, commute
          for (const [path, h] of [
            ['/api/feed', feedHandler],
            ['/api/news', newsHandler],
            ['/api/markets', marketsHandler],
            ['/api/sports', sportsHandler],
            ['/api/commute', commuteHandler],
          ] as const) {
            server.middlewares.use(path, (req, res) => {
              void h(req, res);
            });
          }
          // Push notifications (HUD) and /api/notify (n8n), as on Vercel's rewrite
          server.middlewares.use('/api/push', (req, res) => {
            void pushHandler(req, res);
          });
          server.middlewares.use('/api/notify', (req, res) => {
            void pushHandler(req, res);
          });
        },
      },
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

            // Real Node response plus the Vercel-style helpers the handler uses, so streamed audio
            // (res.write) reaches the browser chunk by chunk, as it does on Vercel.
            const mockRes = Object.assign(res, {
              status(code: number) {
                res.statusCode = code;
                return mockRes;
              },
              json(obj: unknown) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(obj));
              },
              send(buf: Buffer | string) {
                res.end(buf);
              },
            });

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
