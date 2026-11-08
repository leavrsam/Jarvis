// The wake phrase at the start of a transcript ("Hey Jarvis", "Hey, Jarvis.", "OK Jarvis -").
// Transcription services add punctuation ("Hey, Jarvis."), so it's matched loosely.
export const WAKE_PREFIX = /^\s*(?:(?:hey|hi|ok|okay|yo)[\s,.!-]+)?(?:jarvis|travis|jervis|jarvi)\b[\s,.!?-]*/i;

/** The command without the leading wake phrase ("" if it was only the wake phrase) */
export function stripWakePhrase(text: string): string {
  return text.replace(WAKE_PREFIX, '').trim();
}

/** Does the transcript start with the wake phrase? */
export function startsWithWakePhrase(text: string): boolean {
  return WAKE_PREFIX.test(text);
}

// Plain-"Jarvis" wake confirmation. Stricter than WAKE_PREFIX: sound-alikes that the detector
// can confuse with "Jarvis" ("Travis", "jars", "harvest") must not count.
const JARVIS_START = /^\W*(?:(?:hey|hi|ok|okay|yo)\W+)?(?:jarvis|jervis|jarvas|jarves|charvis)\b/i;
const OPENERS = ['hey', 'hi', 'ok', 'okay', 'yo'];

/**
 * Does this transcript start with "Jarvis"? 'wait' while a partial live transcript could still
 * become it ("Jar", "Hey"); `final` (the whole utterance) never waits.
 */
export function jarvisCheck(text: string, final: boolean): 'yes' | 'no' | 'wait' {
  const t = text.trim();
  if (JARVIS_START.test(t)) return 'yes';
  if (final) return 'no';
  const words = t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'wait';
  const [first, second] = words;
  const couldBeJarvis = (w: string) => 'jarvis'.startsWith(w) || 'jervis'.startsWith(w);
  if (words.length === 1) return couldBeJarvis(first) || OPENERS.includes(first) ? 'wait' : 'no';
  if (OPENERS.includes(first) && words.length === 2 && couldBeJarvis(second)) return 'wait';
  return 'no';
}
