// On-device "hey Jarvis" wake word detection with openWakeWord (https://github.com/dscripka/openWakeWord).
//
// Streaming pipeline, matching openWakeWord's AudioFeatures:
//   16 kHz audio in 80 ms chunks (1280 samples, int16 scale)
//   -> melspectrogram.onnx (chunk + 480 samples of context) -> 32-bin frames, transformed x/10 + 2
//   -> embedding_model.onnx on the latest 76 frames -> one 96-dim feature per chunk
//   -> hey_jarvis_v0.1.onnx on the latest 16 features -> score 0..1
// Models: openWakeWord v0.5.1 release (code Apache-2.0; pre-trained models CC BY-NC-SA 4.0,
// i.e. personal / non-commercial use). Served from /models/wakeword/.
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web';
import ortWasmUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import ortMjsUrl from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

export const WAKE_SAMPLE_RATE = 16000;
const CHUNK = 1280; // 80 ms
const CONTEXT = 480; // 3 hops of mel context
const MEL_WINDOW = 76;
const FEATURE_WINDOW = 16;

type Ort = typeof import('onnxruntime-web');

export interface WakeWordModels {
  ort: Ort;
  mel: InferenceSession;
  embedding: InferenceSession;
  wakeword: InferenceSession;
}

let loading: Promise<WakeWordModels> | null = null;

/** Load the three models once (about 3.7 MB, served by the app itself). */
export function loadWakeWordModels(baseUrl = '/models/wakeword/'): Promise<WakeWordModels> {
  if (loading) return loading;
  loading = (async () => {
    const ort = (await import('onnxruntime-web/wasm')) as unknown as Ort;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
    const create = async (file: string) => {
      const res = await fetch(baseUrl + file);
      if (!res.ok) throw new Error(`Wake word model ${file}: HTTP ${res.status}`);
      return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
    };
    const [mel, embedding, wakeword] = await Promise.all([
      create('melspectrogram.onnx'),
      create('embedding_model.onnx'),
      create('hey_jarvis_v0.1.onnx'),
    ]);
    return { ort, mel, embedding, wakeword };
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * A short recorded "hey" (16 kHz). Fed to a second detector just before you start speaking, so
 * a plain "Jarvis…" reaches the "hey Jarvis" model as "hey Jarvis…". Measured on 10 synthetic
 * voices: "Jarvis, <command>" went from 0-6 of 10 detected to 9-10 of 10 at the same threshold.
 */
let promptLoading: Promise<Float32Array> | null = null;
export function loadHeyPrompt(baseUrl = '/models/wakeword/'): Promise<Float32Array> {
  if (promptLoading) return promptLoading;
  promptLoading = (async () => {
    const res = await fetch(baseUrl + 'hey_prompt.wav');
    if (!res.ok) throw new Error(`hey_prompt.wav: HTTP ${res.status}`);
    const view = new DataView(await res.arrayBuffer());
    // Find the "data" chunk of a 16-bit mono WAV
    let o = 12;
    while (o + 8 <= view.byteLength) {
      const id = String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
      const size = view.getUint32(o + 4, true);
      if (id === 'data') {
        const n = Math.floor(Math.min(size, view.byteLength - o - 8) / 2);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = view.getInt16(o + 8 + i * 2, true) / 32768;
        return out;
      }
      o += 8 + size + (size % 2);
    }
    throw new Error('hey_prompt.wav: no audio');
  })().catch((err) => {
    promptLoading = null;
    throw err;
  });
  return promptLoading;
}

/** All detectors share the model sessions, so their inference runs one at a time */
let inferenceQueue: Promise<unknown> = Promise.resolve();

/** Streaming detector: feed 16 kHz audio, get a score per 80 ms chunk. */
export class WakeWordDetector {
  private raw = new Float32Array(0); // recent audio, int16 scale (for mel context)
  private pending = new Float32Array(0);
  private melFrames: Float32Array[] = [];
  private features: Float32Array[] = [];

  constructor(private models: WakeWordModels) {
    // openWakeWord starts the mel buffer with ones so the first embeddings are well-formed
    for (let i = 0; i < MEL_WINDOW; i++) this.melFrames.push(new Float32Array(32).fill(1));
  }

  reset() {
    this.raw = new Float32Array(0);
    this.pending = new Float32Array(0);
    this.features = [];
    this.melFrames = [];
    for (let i = 0; i < MEL_WINDOW; i++) this.melFrames.push(new Float32Array(32).fill(1));
  }

  /**
   * Feed 16 kHz mono audio in [-1, 1]. Resolves with the highest score among the chunks it
   * completed (0 if none). Calls are serialized internally.
   */
  process(samples: Float32Array): Promise<number> {
    const run = inferenceQueue.then(() => this.processNow(samples));
    inferenceQueue = run.catch(() => undefined);
    return run;
  }

  private async processNow(samples: Float32Array): Promise<number> {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    for (let i = 0; i < samples.length; i++) joined[this.pending.length + i] = samples[i] * 32767;
    let offset = 0;
    let best = 0;
    while (joined.length - offset >= CHUNK) {
      const chunk = joined.subarray(offset, offset + CHUNK);
      offset += CHUNK;
      best = Math.max(best, await this.processChunk(chunk));
    }
    this.pending = joined.slice(offset);
    return best;
  }

  private async processChunk(chunk: Float32Array): Promise<number> {
    const { ort, mel, embedding, wakeword } = this.models;
    // Rolling raw buffer: keep chunk + context
    const raw = new Float32Array(Math.min(this.raw.length + chunk.length, CHUNK + CONTEXT));
    const keepOld = raw.length - chunk.length;
    raw.set(this.raw.subarray(this.raw.length - keepOld));
    raw.set(chunk, keepOld);
    this.raw = raw;

    // 1. Mel frames
    const melOut = await mel.run({ input: new ort.Tensor('float32', raw, [1, raw.length]) });
    const melData = (melOut[mel.outputNames[0]] as OrtTensor).data as Float32Array;
    for (let f = 0; f + 32 <= melData.length; f += 32) {
      const frame = new Float32Array(32);
      for (let k = 0; k < 32; k++) frame[k] = melData[f + k] / 10 + 2;
      this.melFrames.push(frame);
    }
    if (this.melFrames.length > 200) this.melFrames.splice(0, this.melFrames.length - 200);

    // 2. One embedding from the latest 76 frames
    const window = this.melFrames.slice(-MEL_WINDOW);
    const embIn = new Float32Array(MEL_WINDOW * 32);
    window.forEach((fr, i) => embIn.set(fr, i * 32));
    const embOut = await embedding.run({ input_1: new ort.Tensor('float32', embIn, [1, MEL_WINDOW, 32, 1]) });
    this.features.push(Float32Array.from((embOut[embedding.outputNames[0]] as OrtTensor).data as Float32Array));
    if (this.features.length > FEATURE_WINDOW) this.features.splice(0, this.features.length - FEATURE_WINDOW);
    if (this.features.length < FEATURE_WINDOW) return 0;

    // 3. Wake word score from the latest 16 features
    const wwIn = new Float32Array(FEATURE_WINDOW * 96);
    this.features.forEach((f, i) => wwIn.set(f, i * 96));
    const out = await wakeword.run({ [wakeword.inputNames[0]]: new ort.Tensor('float32', wwIn, [1, FEATURE_WINDOW, 96]) });
    return ((out[wakeword.outputNames[0]] as OrtTensor).data as Float32Array)[0];
  }
}
