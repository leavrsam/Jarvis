// Fuzzy matching of recognized speech against what Jarvis just said, to catch his own voice coming
// back through the microphone even when the recognizer mishears it ("whether"/"weather",
// "1 moment"/"one moment") or delivers only a partial word ("mom" for "moment").

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
  '8': 'eight', '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve', '15': 'fifteen', '20': 'twenty',
  '30': 'thirty', '40': 'forty', '45': 'forty five', '50': 'fifty',
};

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ') // <short pause> tags
    .replace(/(\d+)/g, (d) => ` ${NUMBER_WORDS[d] ?? d} `)
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function wordMatches(w: string, ref: Set<string>, refList: string[]): boolean {
  if (ref.has(w)) return true;
  for (const r of refList) {
    // Partial word from an interim result: "mom" -> "moment"
    if (w.length >= 3 && r.startsWith(w)) return true;
    // Misheard: one edit for 4+ letters, two for 7+
    const max = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0;
    if (max && editDistance(w, r, max) <= max) return true;
  }
  return false;
}

/**
 * Share (0..1) of the utterance's meaningful words that also appear, exactly or nearly, in what
 * Jarvis said. Short words (< 3 letters) are ignored; an utterance with none counts as 1.
 */
export function echoOverlap(utterance: string, reference: string): number {
  const ref = words(reference);
  if (!ref.length) return 0;
  const refSet = new Set(ref);
  const utt = words(utterance).filter((w) => w.length >= 3);
  if (!utt.length) return 1;
  const matched = utt.filter((w) => wordMatches(w, refSet, ref)).length;
  return matched / utt.length;
}

/** True if `utterance` is most likely Jarvis's own speech heard through the mic. */
export function isLikelyEcho(utterance: string, reference: string, threshold: number): boolean {
  if (!reference.trim()) return false;
  return echoOverlap(utterance, reference) >= threshold;
}
