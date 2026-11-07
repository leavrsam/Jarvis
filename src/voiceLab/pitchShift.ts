// Small offline pitch shifter for speech (no dependencies).
// Pitch shift = resample (changes pitch and duration) + WSOLA time-stretch back to the original
// duration. WSOLA picks each grain where it best lines up with the previous one, which avoids the
// "phasey" sound of plain overlap-add. Good for subtle shifts (about +/-3 semitones) on voice.

const FRAME = 1024; // ~43 ms at 24 kHz
const HOP = FRAME / 2;
const TOLERANCE = 256; // +/- search window for alignment (~10 ms)

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function resample(input: Float32Array, ratio: number): Float32Array {
  // ratio > 1 plays faster: higher pitch, shorter
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Stretch duration by `stretch` (2 = twice as long) without changing pitch. */
export function wsolaStretch(input: Float32Array, stretch: number): Float32Array {
  const outLen = Math.floor(input.length * stretch);
  const out = new Float32Array(outLen + FRAME);
  const norm = new Float32Array(outLen + FRAME);
  const win = hann(FRAME);
  const analysisHop = HOP / stretch;

  let prevPos = 0;
  for (let k = 0; k * HOP < outLen; k++) {
    const nominal = Math.round(k * analysisHop);
    let best = nominal;
    if (k > 0) {
      // Find the input offset whose grain best continues the previous grain
      const natural = prevPos + HOP;
      let bestScore = -Infinity;
      for (let d = -TOLERANCE; d <= TOLERANCE; d += 4) {
        const cand = nominal + d;
        if (cand < 0 || cand + HOP >= input.length) continue;
        let score = 0;
        for (let i = 0; i < HOP; i += 2) score += input[cand + i] * (input[natural + i] ?? 0);
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    const outPos = k * HOP;
    for (let i = 0; i < FRAME; i++) {
      const s = input[best + i] ?? 0;
      out[outPos + i] += s * win[i];
      norm[outPos + i] += win[i];
    }
    prevPos = best;
  }
  const result = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) result[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return result;
}

/** Shift pitch by `semitones` while keeping duration the same. */
export function pitchShiftSamples(input: Float32Array, semitones: number): Float32Array {
  if (!semitones) return input;
  const ratio = Math.pow(2, semitones / 12);
  const resampled = resample(input, ratio); // pitch moved, duration / ratio
  const stretched = wsolaStretch(resampled, ratio); // duration restored
  // Match original length exactly
  const out = new Float32Array(input.length);
  out.set(stretched.subarray(0, input.length));
  return out;
}
