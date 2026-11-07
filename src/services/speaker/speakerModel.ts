// Neural speaker embeddings, computed on the device (voice audio never leaves the browser).
//
// Model: WeSpeaker CAM++ trained on VoxCeleb (wespeaker_en_voxceleb_CAM++.onnx, 29 MB, 512-dim
// embeddings, ~1% EER on VoxCeleb1-O). Downloaded once from Hugging Face, verified against a
// pinned SHA-256 and kept in Cache Storage. Run with onnxruntime-web (WebAssembly, single thread).
//
// Note: graph optimization must stay disabled. onnxruntime's constant folding bakes the first
// input length into this model, after which embeddings for other lengths are garbage.
import type { InferenceSession } from 'onnxruntime-web';
import { computeFbank, resampleTo16k } from './fbank';
// Served as static assets by Vite (the package's export map hides /dist, so use the file path)
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import ortMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

export const SPEAKER_MODEL = {
  name: 'WeSpeaker CAM++ (VoxCeleb)',
  url: 'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/wespeaker_en_voxceleb_CAM%2B%2B.onnx',
  sha256: 'c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef',
  bytes: 29292684,
  dim: 512,
};
const CACHE_NAME = 'jarvis-speaker-model-v1';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

let status: ModelStatus = 'idle';
let lastError = '';
let loadPromise: Promise<InferenceSession> | null = null;
let ortModule: typeof import('onnxruntime-web') | null = null;
const listeners = new Set<(s: ModelStatus) => void>();

function setStatus(s: ModelStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export function getModelStatus(): { status: ModelStatus; error: string } {
  return { status, error: lastError };
}

export function onModelStatus(listener: (s: ModelStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchModelBytes(): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(SPEAKER_MODEL.url);
    if (hit) {
      const bytes = await hit.arrayBuffer();
      if ((await sha256Hex(bytes)) === SPEAKER_MODEL.sha256) return bytes;
      await cache.delete(SPEAKER_MODEL.url); // corrupted: fetch again
    }
  } catch {
    cache = null; // Cache Storage unavailable (e.g. private mode): just download
  }
  const res = await fetch(SPEAKER_MODEL.url);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  if (hash !== SPEAKER_MODEL.sha256) throw new Error('Model file failed its integrity check');
  try {
    await cache?.put(SPEAKER_MODEL.url, new Response(bytes.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
  } catch {}
  return bytes;
}

/** Load (once) and return the inference session. Safe to call repeatedly. */
export function loadSpeakerModel(): Promise<InferenceSession> {
  if (loadPromise) return loadPromise;
  setStatus('loading');
  lastError = '';
  loadPromise = (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1; // no cross-origin isolation, so no threads
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
    ortModule = ort as unknown as typeof import('onnxruntime-web');
    const bytes = await fetchModelBytes();
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled',
    });
    setStatus('ready');
    return session;
  })().catch((err) => {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn('[SpeakerModel] Failed to load:', lastError);
    loadPromise = null; // allow a retry later
    setStatus('error');
    throw err;
  });
  return loadPromise;
}

export function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/** Unit-length 512-dim voiceprint for a mono clip at any sample rate. */
export async function embedSpeech(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
  const session = await loadSpeakerModel();
  const audio16k = resampleTo16k(samples, sampleRate);
  const { data, numFrames } = computeFbank(audio16k);
  if (numFrames < 50) throw new Error('Not enough audio for a voiceprint');
  const feats = new ortModule!.Tensor('float32', data, [1, numFrames, 80]);
  const out = await session.run({ feats });
  return normalize(out.embs.data as Float32Array);
}
