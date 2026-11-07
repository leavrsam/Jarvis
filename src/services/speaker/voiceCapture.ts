// Rolling microphone buffer for speaker identification.
//
// The wake word and the command often arrive in one breath ("Hey Jarvis, what's the weather"),
// before any per-command recording could start, so the mic is buffered continuously (last 15 s,
// in memory only) while Jarvis is unlocked. Each chunk is time-stamped so the caller can pull out
// the user's utterance and skip anything recorded while Jarvis himself was talking.

import { micConstraints, onMicSettingsChange } from '../micSettings';

const CHUNK = 2048;
const KEEP_MS = 15_000;

const WORKLET_SOURCE = `
class JarvisVoiceCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('jarvis-voice-capture', JarvisVoiceCapture);
`;

interface Chunk {
  /** Date.now() when the chunk's last sample was captured */
  endAt: number;
  data: Float32Array;
}

export interface TimeInterval {
  start: number;
  end: number;
}

class VoiceCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private chunks: Chunk[] = [];
  private starting: Promise<boolean> | null = null;
  private listeners = new Set<(data: Float32Array, sampleRate: number, endAt: number) => void>();

  /** Receive every mic chunk as it arrives (the wake word listener uses this). */
  onAudio(listener: (data: Float32Array, sampleRate: number, endAt: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  constructor() {
    // Echo cancellation setting changed: reopen the mic with the new settings
    if (typeof window !== 'undefined') {
      onMicSettingsChange(() => {
        if (!this.isRunning()) return;
        this.stop();
        void this.start();
      });
    }
  }

  /** The live mic stream (shared with the visualizer so only one mic stream is open) */
  getStream(): MediaStream | null {
    return this.stream;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  isRunning(): boolean {
    return Boolean(this.stream && this.ctx);
  }

  /** Start buffering the microphone. Resolves false if the mic is unavailable. */
  start(): Promise<boolean> {
    if (this.isRunning()) {
      void this.ctx?.resume().catch(() => {});
      return Promise.resolve(true);
    }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: micConstraints(),
        });
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioCtx();
        const source = this.ctx.createMediaStreamSource(this.stream);
        const sink = this.ctx.createGain();
        sink.gain.value = 0; // keep the graph pulled without making any sound
        sink.connect(this.ctx.destination);

        const onData = (data: Float32Array) => {
          const now = Date.now();
          this.chunks.push({ endAt: now, data });
          this.listeners.forEach((l) => {
            try {
              l(data, this.sampleRate, now);
            } catch (err) {
              console.warn('[VoiceCapture] listener failed:', err);
            }
          });
          while (this.chunks.length && now - this.chunks[0].endAt > KEEP_MS) this.chunks.shift();
        };

        if (this.ctx.audioWorklet) {
          const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
          await this.ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const node = new AudioWorkletNode(this.ctx, 'jarvis-voice-capture');
          node.port.onmessage = (e) => onData(e.data as Float32Array);
          source.connect(node);
          node.connect(sink);
          this.node = node;
        } else {
          const node = this.ctx.createScriptProcessor(CHUNK, 1, 1);
          node.onaudioprocess = (e) => onData(e.inputBuffer.getChannelData(0).slice(0));
          source.connect(node);
          node.connect(sink);
          this.node = node;
        }
        // Without a user gesture the context may start suspended; resume on the next interaction
        if (this.ctx.state === 'suspended') {
          const resume = () => void this.ctx?.resume().catch(() => {});
          window.addEventListener('pointerdown', resume, { once: true });
          window.addEventListener('keydown', resume, { once: true });
          resume();
        }
        return true;
      } catch (err) {
        console.warn('[VoiceCapture] Microphone unavailable:', err);
        this.stop();
        return false;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  /** Current input level 0..1 (RMS of the latest chunk), for meters */
  getLevel(): number {
    const last = this.chunks[this.chunks.length - 1];
    if (!last || Date.now() - last.endAt > 500) return 0;
    let sum = 0;
    for (let i = 0; i < last.data.length; i++) sum += last.data[i] * last.data[i];
    return Math.min(1, Math.sqrt(sum / last.data.length) * 6);
  }

  stop() {
    try {
      this.node?.disconnect();
    } catch {}
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chunks = [];
  }

  /**
   * Audio captured between `fromMs` and `toMs` (Date.now() times), leaving out any chunk that
   * overlaps an excluded interval (e.g. while Jarvis was speaking, plus a short tail).
   */
  getAudio(fromMs: number, toMs: number, exclude: TimeInterval[] = []): Float32Array {
    const chunkMs = (CHUNK / this.sampleRate) * 1000;
    const keep = this.chunks.filter((c) => {
      const start = c.endAt - chunkMs;
      if (c.endAt < fromMs || start > toMs) return false;
      return !exclude.some((iv) => start < iv.end && c.endAt > iv.start);
    });
    const out = new Float32Array(keep.reduce((n, c) => n + c.data.length, 0));
    let offset = 0;
    for (const c of keep) {
      out.set(c.data, offset);
      offset += c.data.length;
    }
    return out;
  }
}

export const voiceCapture = new VoiceCapture();

/**
 * Keep only the speech in a clip: 30 ms frames above an adaptive energy threshold (relative to
 * the clip's loudest frames and its noise floor), with short gaps bridged.
 */
export function extractSpeech(samples: Float32Array, sampleRate: number): { speech: Float32Array; seconds: number } {
  const frame = Math.round(sampleRate * 0.03);
  const n = Math.floor(samples.length / frame);
  if (n === 0) return { speech: new Float32Array(0), seconds: 0 };
  const energies = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    for (let i = 0; i < frame; i++) e += samples[f * frame + i] ** 2;
    energies[f] = 10 * Math.log10(e / frame + 1e-10);
  }
  const sorted = Array.from(energies).sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)];
  const peak = sorted[Math.floor(n * 0.95)];
  // Speech: at least 10 dB over the noise floor and within 30 dB of the loud frames
  const threshold = Math.max(noise + 10, peak - 30, -55);
  const isSpeech = Array.from(energies, (e) => e > threshold);
  // Bridge gaps up to 150 ms so words aren't chopped
  for (let f = 0; f < n; f++) {
    if (isSpeech[f]) continue;
    let g = f;
    while (g < n && !isSpeech[g]) g++;
    if (f > 0 && g < n && g - f <= 5) for (let k = f; k < g; k++) isSpeech[k] = true;
    f = g;
  }
  const kept = isSpeech.filter(Boolean).length;
  const speech = new Float32Array(kept * frame);
  let o = 0;
  for (let f = 0; f < n; f++) {
    if (!isSpeech[f]) continue;
    speech.set(samples.subarray(f * frame, (f + 1) * frame), o);
    o += frame;
  }
  return { speech, seconds: speech.length / sampleRate };
}
