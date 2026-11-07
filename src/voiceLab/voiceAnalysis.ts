// Objective voice measurements for auto-matching one TTS voice to another.
// Measures pitch, pace and tonal balance; it can't judge accent or character, which is why
// the page always lets you A/B by ear afterwards.

export interface VoiceProfile {
  /** Median fundamental frequency of voiced speech, Hz */
  f0Median: number;
  /** Pitch movement: spread of voiced pitch in semitones (interquartile range). Low = monotone */
  f0SpreadSt: number;
  /** Speech duration with leading/trailing silence trimmed, seconds */
  speechSec: number;
  /** Total internal pause time (gaps >= 150 ms), seconds */
  pauseSec: number;
  /** Long-term spectrum: each band's level in dB relative to the 1-2 kHz band */
  bands: BandLevels;
  voicedFrames: number;
}

export interface BandLevels {
  body: number; // 100-300 Hz: chest / warmth
  lowMid: number; // 300-1000 Hz
  mid: number; // 1-2 kHz
  presence: number; // 2-5 kHz: diction / crispness
  air: number; // 5-10 kHz
}

const BAND_EDGES: Record<keyof BandLevels, [number, number]> = {
  body: [100, 300],
  lowMid: [300, 1000],
  mid: [1000, 2000],
  presence: [2000, 5000],
  air: [5000, 10000],
};

const FFT_SIZE = 1024;

function fftPower(frame: Float32Array): Float32Array {
  // In-place radix-2 FFT on a copy; returns power spectrum for bins 0..N/2
  const n = frame.length;
  const re = Float32Array.from(frame);
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const power = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};

interface RawAnalysis {
  f0s: number[];
  speechSec: number;
  pauseSec: number;
  bandPower: Record<keyof BandLevels, number>;
  totalPower: number;
}

function analyzeRaw(samples: Float32Array, sr: number): RawAnalysis {
  const hop = Math.round(sr * 0.01);
  const win = FFT_SIZE;
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);

  // Frame energies (dB)
  const frames: number[] = [];
  for (let start = 0; start + win <= samples.length; start += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += samples[start + i] ** 2;
    frames.push(10 * Math.log10(e / win + 1e-12));
  }
  const peak = Math.max(...frames, -120);
  const threshold = peak - 35;
  const isSpeech = frames.map((db) => db > threshold);
  const first = isSpeech.indexOf(true);
  const last = isSpeech.lastIndexOf(true);
  const empty: Record<keyof BandLevels, number> = { body: 0, lowMid: 0, mid: 0, presence: 0, air: 0 };
  if (first < 0) return { f0s: [], speechSec: 0, pauseSec: 0, bandPower: empty, totalPower: 0 };

  const speechSec = ((last - first) * hop + win) / sr;
  let pauseSec = 0;
  let run = 0;
  for (let f = first; f <= last; f++) {
    if (!isSpeech[f]) run++;
    else {
      if (run * hop >= sr * 0.15) pauseSec += (run * hop) / sr;
      run = 0;
    }
  }

  const minLag = Math.floor(sr / 320);
  const maxLag = Math.ceil(sr / 60);
  const f0s: number[] = [];
  const bandPower = { ...empty };
  let totalPower = 0;
  const binHz = sr / FFT_SIZE;

  for (let f = first; f <= last; f++) {
    if (!isSpeech[f]) continue;
    const start = f * hop;
    const frame = samples.subarray(start, start + win);

    // Pitch: normalized autocorrelation, voiced if the peak is strong
    let bestLag = 0;
    let bestR = 0;
    for (let lag = minLag; lag <= maxLag && lag < win / 2; lag++) {
      let num = 0;
      let e0 = 0;
      let e1 = 0;
      for (let i = 0; i + lag < win; i += 2) {
        num += frame[i] * frame[i + lag];
        e0 += frame[i] * frame[i];
        e1 += frame[i + lag] * frame[i + lag];
      }
      const r = num / Math.sqrt(e0 * e1 + 1e-12);
      if (r > bestR) {
        bestR = r;
        bestLag = lag;
      }
    }
    if (bestR > 0.6 && bestLag) f0s.push(sr / bestLag);

    // Long-term spectrum
    const windowed = new Float32Array(win);
    for (let i = 0; i < win; i++) windowed[i] = frame[i] * hann[i];
    const power = fftPower(windowed);
    for (const [band, [lo, hi]] of Object.entries(BAND_EDGES) as [keyof BandLevels, [number, number]][]) {
      const top = Math.min(hi, sr / 2);
      for (let b = Math.ceil(lo / binHz); b * binHz < top; b++) bandPower[band] += power[b];
    }
    for (let b = Math.ceil(100 / binHz); b * binHz < Math.min(10000, sr / 2); b++) totalPower += power[b];
  }
  return { f0s, speechSec, pauseSec, bandPower, totalPower };
}

function toProfile(raws: RawAnalysis[]): VoiceProfile {
  const f0s = raws.flatMap((r) => r.f0s);
  const f0Median = median(f0s);
  // Drop octave errors before measuring spread
  const clean = f0s.filter((f) => f > f0Median / 1.7 && f < f0Median * 1.7).map((f) => 12 * Math.log2(f / f0Median));
  // Each band relative to 1-2 kHz, which none of the polish filters touch. (Relative to the total,
  // a dominant low band would hide most of its own change.)
  const anchor = raws.reduce((s, r) => s + r.bandPower.mid, 0) || 1;
  const bands = {} as BandLevels;
  for (const band of Object.keys(BAND_EDGES) as (keyof BandLevels)[]) {
    const p = raws.reduce((s, r) => s + r.bandPower[band], 0);
    bands[band] = 10 * Math.log10(p / anchor + 1e-12);
  }
  return {
    f0Median,
    f0SpreadSt: quantile(clean, 0.75) - quantile(clean, 0.25),
    speechSec: raws.reduce((s, r) => s + r.speechSec, 0),
    pauseSec: raws.reduce((s, r) => s + r.pauseSec, 0),
    bands,
    voicedFrames: f0s.length,
  };
}

/** Profile a voice across several clips (ideally the same lines for both voices). */
export function profileClips(clips: { samples: Float32Array; sampleRate: number }[]): VoiceProfile {
  return toProfile(clips.map((c) => analyzeRaw(c.samples, c.sampleRate)));
}

export interface MatchSuggestion {
  pitchSemitones: number;
  warmthDelta: number;
  presenceDelta: number;
  /** Suggested provider speed (needs regenerated clips), or null if the voice has no speed control */
  speed: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Settings that move `target` toward `reference`. `current` is what's already applied to the
 * target clips being measured, so this can be called again on a processed render to refine.
 */
export function suggestMatch(
  reference: VoiceProfile,
  target: VoiceProfile,
  current: { pitchSemitones: number; warmthDelta: number; presenceDelta: number },
  speedInfo: { current: number; min: number; max: number } | null
): MatchSuggestion {
  const pitchResidual = reference.f0Median && target.f0Median ? 12 * Math.log2(reference.f0Median / target.f0Median) : 0;
  // The 190 Hz and 3.65 kHz peaking filters only cover part of each band, so correct a bit beyond the gap
  const bodyGap = reference.bands.body - target.bands.body;
  const presenceGap = reference.bands.presence - target.bands.presence;
  let speed: number | null = null;
  if (speedInfo && reference.speechSec > 0 && target.speechSec > 0) {
    // Longer target = slower speech, so raise its speed by the duration ratio
    speed = clamp(roundTo(speedInfo.current * (target.speechSec / reference.speechSec), 0.05), speedInfo.min, speedInfo.max);
    speed = Math.round(speed * 100) / 100;
  }
  return {
    pitchSemitones: clamp(roundTo(current.pitchSemitones + pitchResidual, 0.25), -3, 3),
    warmthDelta: clamp(roundTo(current.warmthDelta + bodyGap * 1.2, 0.5), -6, 6),
    presenceDelta: clamp(roundTo(current.presenceDelta + presenceGap * 1.2, 0.5), -6, 6),
    speed,
  };
}
