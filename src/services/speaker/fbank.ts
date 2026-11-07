// Kaldi-compatible 80-bin log-mel filterbank ("fbank") features, matching what WeSpeaker models
// were trained with: torchaudio.compliance.kaldi.fbank(num_mel_bins=80, frame_length=25,
// frame_shift=10, dither=0, window_type='hamming', sample_frequency=16000), on samples scaled to
// the int16 range, followed by per-utterance mean normalization (CMN).

export const FBANK_SAMPLE_RATE = 16000;
const FRAME_LENGTH = 400; // 25 ms
const FRAME_SHIFT = 160; // 10 ms
const FFT_SIZE = 512; // next power of two
const NUM_BINS = 80;
const LOW_FREQ = 20;
const HIGH_FREQ = FBANK_SAMPLE_RATE / 2;
const PREEMPH = 0.97;
const EPS = 1.1920928955078125e-7; // float32 epsilon, Kaldi's log floor

const melScale = (hz: number) => 1127 * Math.log(1 + hz / 700);

let cache: { window: Float32Array; banks: { start: number; weights: Float32Array }[] } | null = null;

function setup() {
  if (cache) return cache;
  const window = new Float32Array(FRAME_LENGTH);
  for (let i = 0; i < FRAME_LENGTH; i++) window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));

  // Kaldi mel banks: triangles equally spaced in mel between LOW_FREQ and HIGH_FREQ, evaluated
  // at each FFT bin's mel frequency (bins 0..FFT_SIZE/2 - 1)
  const numFftBins = FFT_SIZE / 2;
  const binHz = FBANK_SAMPLE_RATE / FFT_SIZE;
  const melLow = melScale(LOW_FREQ);
  const melHigh = melScale(HIGH_FREQ);
  const melDelta = (melHigh - melLow) / (NUM_BINS + 1);
  const banks: { start: number; weights: Float32Array }[] = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = melLow + b * melDelta;
    const center = left + melDelta;
    const right = center + melDelta;
    let first = -1;
    const w: number[] = [];
    for (let i = 0; i < numFftBins; i++) {
      const mel = melScale(binHz * i);
      if (mel > left && mel < right) {
        const weight = mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center);
        if (first < 0) first = i;
        w[i - first] = weight;
      }
    }
    banks.push({ start: Math.max(0, first), weights: Float32Array.from(w.map((x) => x ?? 0)) });
  }
  cache = { window, banks };
  return cache;
}

/** In-place iterative radix-2 FFT; returns the power spectrum for bins 0..n/2. */
function powerSpectrum(re: Float32Array): Float32Array {
  const n = re.length;
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i];
      re[i] = re[j];
      re[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const out = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

/**
 * Compute mean-normalized fbank features for 16 kHz mono audio in [-1, 1].
 * Returns a flat Float32Array of numFrames * 80 values (row-major [T, 80]).
 */
export function computeFbank(samples: Float32Array): { data: Float32Array; numFrames: number } {
  const { window, banks } = setup();
  const numFrames = samples.length < FRAME_LENGTH ? 0 : 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_SHIFT);
  const data = new Float32Array(numFrames * NUM_BINS);
  const frame = new Float32Array(FFT_SIZE);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * FRAME_SHIFT;
    // Scale to int16 range and remove DC offset
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) mean += samples[offset + i] * 32768;
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i++) frame[i] = samples[offset + i] * 32768 - mean;
    // Pre-emphasis (Kaldi: first sample uses itself as the previous one)
    for (let i = FRAME_LENGTH - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
    frame[0] -= PREEMPH * frame[0];
    for (let i = 0; i < FRAME_LENGTH; i++) frame[i] *= window[i];
    frame.fill(0, FRAME_LENGTH);

    const power = powerSpectrum(frame);
    for (let b = 0; b < NUM_BINS; b++) {
      const { start, weights } = banks[b];
      let energy = 0;
      for (let k = 0; k < weights.length; k++) energy += weights[k] * power[start + k];
      data[f * NUM_BINS + b] = Math.log(Math.max(energy, EPS));
    }
  }

  // Cepstral mean normalization over the utterance
  if (numFrames > 0) {
    for (let b = 0; b < NUM_BINS; b++) {
      let sum = 0;
      for (let f = 0; f < numFrames; f++) sum += data[f * NUM_BINS + b];
      const m = sum / numFrames;
      for (let f = 0; f < numFrames; f++) data[f * NUM_BINS + b] -= m;
    }
  }
  return { data, numFrames };
}

/** Linear-interpolation resample to 16 kHz (input is the AudioContext rate, e.g. 48 kHz). */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === FBANK_SAMPLE_RATE) return input;
  const ratio = inputRate / FBANK_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  // Simple low-pass (moving average over the decimation window) to limit aliasing
  const span = Math.max(1, Math.round(ratio));
  for (let i = 0; i < outLen; i++) {
    const center = i * ratio;
    let sum = 0;
    let count = 0;
    for (let k = -Math.floor(span / 2); k <= Math.floor(span / 2); k++) {
      const idx = Math.round(center) + k;
      if (idx >= 0 && idx < input.length) {
        sum += input[idx];
        count++;
      }
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}
