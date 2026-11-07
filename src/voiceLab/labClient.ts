import { pitchShiftSamples } from './pitchShift';

// Client for the voice comparison lab: fetches audio from /api/voice-lab, plays it as it streams,
// measures latency, and caches every clip in IndexedDB so replays never call a provider again.

export interface LabVoice {
  id: string;
  provider: string;
  providerName: string;
  voiceName: string;
  accent: string;
  streaming: boolean;
  streamNote: string;
  priceText: string;
  costPerChar: number | null;
  costPerSecond: number | null;
  configured: boolean;
  envVars: string[];
  /** Delivery controls the provider accepts (Deepgram only) */
  tunable?: { speedMin: number; speedMax: number; expressivity: boolean };
}

export interface VoiceTuning {
  speed: number;
  /** -2 calm ... +2 animated (Deepgram Flux only) */
  expressivity: number;
}

export const DEFAULT_TUNING: VoiceTuning = { speed: 1, expressivity: 0 };

export interface LabMetrics {
  /** Request sent -> first audio audible */
  ttfaMs: number;
  /** Request sent -> last byte received */
  totalMs: number;
  chars: number;
  audioSec: number;
  costUsd: number;
  /** Played progressively while downloading */
  streamedPlayback: boolean;
  /** Served from the server-side lab cache (timings then reflect the cache, not the provider) */
  serverCacheHit: boolean;
  generatedAt: number;
}

interface ClipRecord {
  key: string;
  format: 'pcm16' | 'mp3' | 'wav';
  sampleRate: number;
  bytes: ArrayBuffer;
  metrics: LabMetrics;
}

export interface PlayResult {
  metrics: LabMetrics;
  fromBrowserCache: boolean;
}

const DB_NAME = 'jarvis-voice-lab';
const STORE = 'clips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ClipRecord | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as ClipRecord | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(record: ClipRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

/** Metrics of every clip already generated, keyed like cellKey(), for showing results on load. */
export async function loadAllCachedMetrics(): Promise<Record<string, LabMetrics>> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const out: Record<string, LabMetrics> = {};
      const req = db.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        const rec = cursor.value as ClipRecord;
        out[rec.key] = rec.metrics;
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch {
    return {};
  }
}

export function cellKey(
  voice: LabVoice,
  text: string,
  gemini: { voice: string; style: string },
  tuning?: VoiceTuning
): string {
  const extra = voice.provider === 'gemini' ? `|${gemini.voice}|${gemini.style}` : '';
  const tune = voice.tunable && tuning ? `|s${tuning.speed}|e${voice.tunable.expressivity ? tuning.expressivity : 0}` : '';
  return `${voice.id}|${voice.voiceName}${extra}${tune}|${text}`;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let session = 0;
const activeSources = new Set<AudioBufferSourceNode>();
let activeAudioEl: HTMLAudioElement | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

export function stopAll() {
  session++;
  activeSources.forEach((s) => {
    try {
      s.stop();
    } catch {}
  });
  activeSources.clear();
  if (activeAudioEl) {
    activeAudioEl.pause();
    activeAudioEl.removeAttribute('src');
    activeAudioEl.load();
    activeAudioEl = null;
  }
}

function pcmToBuffer(bytes: Uint8Array, sampleRate: number): AudioBuffer {
  const samples = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
  const buffer = ctx().createBuffer(1, Math.max(1, samples), sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

// ---------------------------------------------------------------------------
// "Jarvis polish": the live app's vocal chain (audioEngine.connectJarvisVocalChain) reproduced
// here so any provider can be heard as it would sound inside Jarvis, plus an optional pitch shift.
// Applied at playback, so it works on cached clips and costs no API calls.
// ---------------------------------------------------------------------------
/** Extra adjustments for the voice being matched (never applied to the Gemini reference). */
export interface MatchAdjust {
  pitchSemitones: number;
  warmthDelta: number;
  presenceDelta: number;
}

export const NO_MATCH: MatchAdjust = { pitchSemitones: 0, warmthDelta: 0, presenceDelta: 0 };

export interface LabPolish {
  enabled: boolean;
  /** The live app's EQ, applied to every voice */
  warmthDb: number;
  presenceDb: number;
  intercomWet: number;
  /** Auto-match / manual adjustments, applied to every voice except the Gemini reference */
  match: MatchAdjust;
}

let polish: LabPolish = { enabled: false, warmthDb: 2.2, presenceDb: 2.4, intercomWet: 0.08, match: { ...NO_MATCH } };

export function setPolish(next: LabPolish) {
  polish = { ...next, match: { ...NO_MATCH, ...next.match } };
}

/** Polish needs the whole clip (pitch shift) and the Web Audio graph, so it plays after download. */
function polishActive() {
  return polish.enabled;
}

function connectPolishChain(source: AudioNode, c: BaseAudioContext, adj: MatchAdjust) {
  const t = c.currentTime;
  const highPass = c.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.setValueAtTime(80, t);
  highPass.Q.setValueAtTime(0.7, t);
  const chest = c.createBiquadFilter();
  chest.type = 'peaking';
  chest.frequency.setValueAtTime(190, t);
  chest.gain.setValueAtTime(polish.warmthDb + adj.warmthDelta, t);
  chest.Q.setValueAtTime(1.1, t);
  const boxCut = c.createBiquadFilter();
  boxCut.type = 'peaking';
  boxCut.frequency.setValueAtTime(480, t);
  boxCut.gain.setValueAtTime(-1.5, t);
  boxCut.Q.setValueAtTime(1.4, t);
  const presence = c.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.setValueAtTime(3650, t);
  presence.gain.setValueAtTime(polish.presenceDb + adj.presenceDelta, t);
  presence.Q.setValueAtTime(1.2, t);
  const air = c.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.setValueAtTime(9200, t);
  air.gain.setValueAtTime(1.6, t);
  const comp = c.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-20, t);
  comp.knee.setValueAtTime(12, t);
  comp.ratio.setValueAtTime(3, t);
  comp.attack.setValueAtTime(0.003, t);
  comp.release.setValueAtTime(0.15, t);
  const dry = c.createGain();
  dry.gain.setValueAtTime(0.96, t);
  const delay = c.createDelay(0.05);
  delay.delayTime.setValueAtTime(0.011, t);
  const wetFilter = c.createBiquadFilter();
  wetFilter.type = 'bandpass';
  wetFilter.frequency.setValueAtTime(1800, t);
  wetFilter.Q.setValueAtTime(0.9, t);
  const wet = c.createGain();
  wet.gain.setValueAtTime(polish.intercomWet, t);
  const master = c.createGain();
  master.gain.setValueAtTime(1.06, t);

  source.connect(highPass);
  highPass.connect(chest);
  chest.connect(boxCut);
  boxCut.connect(presence);
  presence.connect(air);
  air.connect(comp);
  comp.connect(dry);
  dry.connect(master);
  comp.connect(delay);
  delay.connect(wetFilter);
  wetFilter.connect(wet);
  wet.connect(master);
  master.connect(c.destination);
}

function pitched(buffer: AudioBuffer, semitones: number, c: BaseAudioContext = ctx()): AudioBuffer {
  if (!semitones) return buffer;
  const shifted = c.createBuffer(1, buffer.length, buffer.sampleRate);
  shifted.copyToChannel(pitchShiftSamples(buffer.getChannelData(0), semitones) as Float32Array<ArrayBuffer>, 0);
  return shifted;
}

function playBuffer(buffer: AudioBuffer, when = 0, isReference = false): AudioBufferSourceNode {
  const source = ctx().createBufferSource();
  const adj = isReference ? NO_MATCH : polish.match;
  if (polishActive()) {
    source.buffer = pitched(buffer, adj.pitchSemitones);
    connectPolishChain(source, ctx(), adj);
  } else {
    source.buffer = buffer;
    source.connect(ctx().destination);
  }
  source.onended = () => activeSources.delete(source);
  activeSources.add(source);
  source.start(when);
  return source;
}

/**
 * Render a clip through polish + match adjustments offline (for measuring what you'd hear).
 * Always applies the chain, whether or not the polish switch is on.
 */
export async function renderProcessed(buffer: AudioBuffer, adj: MatchAdjust): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = pitched(buffer, adj.pitchSemitones, offline);
  connectPolishChain(source, offline, adj);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Decoded audio for a cached cell, or null if it hasn't been generated yet. */
export async function getCachedBuffer(key: string): Promise<AudioBuffer | null> {
  const rec = await idbGet(key);
  if (!rec) return null;
  return decodeBytes(rec.format, rec.bytes, rec.sampleRate);
}

/** Play clips back to back (e.g. Gemini then the matched voice) through the current polish. */
export async function playSequence(items: { buffer: AudioBuffer; isReference: boolean }[]) {
  stopAll();
  const c = ctx();
  let at = c.currentTime + 0.05;
  for (const item of items) {
    playBuffer(item.buffer, at, item.isReference);
    at += item.buffer.duration + 0.6;
  }
}

async function decodeBytes(format: ClipRecord['format'], bytes: ArrayBuffer, sampleRate: number) {
  if (format === 'pcm16') return pcmToBuffer(new Uint8Array(bytes), sampleRate);
  return ctx().decodeAudioData(bytes.slice(0));
}

async function playRecord(record: ClipRecord, isReference: boolean) {
  stopAll();
  const buffer = await decodeBytes(record.format, record.bytes, record.sampleRate);
  playBuffer(buffer, 0, isReference);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Progressive MP3 playback through Media Source Extensions. Returns null if unsupported. */
function createMp3StreamPlayer(mySession: number, onAudible: () => void) {
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) return null;
  const mediaSource = new MediaSource();
  const audio = new Audio();
  audio.src = URL.createObjectURL(mediaSource);
  activeAudioEl = audio;
  audio.addEventListener('playing', onAudible, { once: true });
  const queue: Uint8Array[] = [];
  let sourceBuffer: SourceBuffer | null = null;
  let ended = false;
  let started = false;

  const pump = () => {
    if (!sourceBuffer || sourceBuffer.updating) return;
    const next = queue.shift();
    if (next) {
      sourceBuffer.appendBuffer(next as BufferSource);
      if (!started && session === mySession) {
        started = true;
        void audio.play().catch(() => {});
      }
    } else if (ended && mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch {}
    }
  };

  mediaSource.addEventListener(
    'sourceopen',
    () => {
      sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      sourceBuffer.addEventListener('updateend', pump);
      pump();
    },
    { once: true }
  );

  return {
    push(chunk: Uint8Array) {
      queue.push(chunk);
      pump();
    },
    end() {
      ended = true;
      pump();
    },
  };
}

export async function playCell(opts: {
  voice: LabVoice;
  text: string;
  regenerate: boolean;
  gemini: { voice: string; style: string; apiKey: string };
  secret: string;
  tuning?: VoiceTuning;
  /** Generate and cache without playing (used by auto-match) */
  silent?: boolean;
}): Promise<PlayResult> {
  const { voice, text, regenerate, gemini, secret, tuning, silent } = opts;
  const key = cellKey(voice, text, gemini, tuning);
  const isReference = voice.provider === 'gemini';

  if (!regenerate) {
    const cached = await idbGet(key);
    if (cached) {
      if (!silent) await playRecord(cached, isReference);
      return { metrics: cached.metrics, fromBrowserCache: true };
    }
  }

  if (!silent) stopAll();
  // A silent fetch must never play: give it a session id that playback can't match
  const mySession = silent ? -1 : session;
  ctx(); // create/resume inside the click gesture

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-jarvis-secret': secret,
  };
  if (voice.provider === 'gemini' && gemini.apiKey) headers['x-gemini-api-key'] = gemini.apiKey;

  const t0 = performance.now();
  const response = await fetch('/api/voice-lab', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      voiceId: voice.id,
      text,
      regenerate,
      geminiVoice: gemini.voice,
      geminiStyle: gemini.style,
      tuning: voice.tunable ? tuning || DEFAULT_TUNING : undefined,
    }),
  });
  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const format = (response.headers.get('X-Lab-Format') || 'wav') as ClipRecord['format'];
  const sampleRate = Number(response.headers.get('X-Lab-Sample-Rate')) || 24000;
  const serverCacheHit = response.headers.get('X-Lab-Cache') === 'HIT';

  let ttfaMs = 0;
  const markAudible = (extraDelayMs = 0) => {
    if (!ttfaMs) ttfaMs = performance.now() - t0 + extraDelayMs;
  };

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let streamedPlayback = false;

  // PCM: schedule each chunk on the Web Audio clock as it arrives
  let nextTime = 0;
  let leftover: Uint8Array | null = null;
  const mp3Player =
    format === 'mp3' && !polishActive() && !silent ? createMp3StreamPlayer(mySession, () => markAudible()) : null;
  if (mp3Player) streamedPlayback = true;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    chunks.push(value);
    if (silent) markAudible(); // nothing plays; record time to first audio data instead

    if (format === 'pcm16' && session === mySession && !polishActive()) {
      let data = value;
      if (leftover) {
        data = concat([leftover, value]);
        leftover = null;
      }
      if (data.byteLength % 2 === 1) {
        leftover = data.slice(data.byteLength - 1);
        data = data.slice(0, data.byteLength - 1);
      }
      if (data.byteLength >= 2) {
        const buffer = pcmToBuffer(data, sampleRate);
        const c = ctx();
        const startAt = Math.max(c.currentTime + 0.03, nextTime);
        playBuffer(buffer, startAt, isReference);
        if (!ttfaMs) markAudible((startAt - c.currentTime) * 1000);
        nextTime = startAt + buffer.duration;
        streamedPlayback = true;
      }
    } else if (mp3Player && session === mySession) {
      mp3Player.push(value);
    }
  }
  const totalMs = performance.now() - t0;
  mp3Player?.end();

  const allBytes = concat(chunks);
  const bytes = allBytes.buffer.slice(allBytes.byteOffset, allBytes.byteOffset + allBytes.byteLength) as ArrayBuffer;

  // Non-streamed formats (and MP3 where MSE is unavailable): play once fully downloaded
  let decoded: AudioBuffer | null = null;
  if (format === 'wav' || (format === 'mp3' && !mp3Player) || (format === 'pcm16' && polishActive())) {
    decoded = await decodeBytes(format, bytes, sampleRate);
    if (session === mySession) {
      playBuffer(decoded, 0, isReference);
      markAudible();
    }
  }
  if (!ttfaMs) ttfaMs = totalMs; // e.g. stopped before audible

  if (!decoded) decoded = await decodeBytes(format, bytes, sampleRate).catch(() => null);
  const audioSec = decoded ? decoded.duration : format === 'pcm16' ? bytes.byteLength / 2 / sampleRate : 0;

  const chars = text.length;
  const costUsd =
    voice.costPerChar != null
      ? voice.costPerChar * chars
      : voice.costPerSecond != null
        ? voice.costPerSecond * audioSec
        : 0;

  const metrics: LabMetrics = {
    ttfaMs: Math.round(ttfaMs),
    totalMs: Math.round(totalMs),
    chars,
    audioSec: Math.round(audioSec * 100) / 100,
    costUsd,
    streamedPlayback,
    serverCacheHit,
    generatedAt: Date.now(),
  };
  if (bytes.byteLength > 256) await idbPut({ key, format, sampleRate, bytes, metrics });
  return { metrics, fromBrowserCache: false };
}
