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

// The wake phrase in the middle of a transcript, only when it's clearly addressing Jarvis:
// "hey/ok Jarvis", "Jarvis" starting a sentence, or "Jarvis," (direct address). A mention like
// "make it say Jarvis drop" is not a wake phrase, and "Travis" mid-sentence is a person.
const WAKE_ANYWHERE =
  /(?:\b(?:hey|hi|ok|okay|yo)[\s,.!-]+(?:jarvis|jervis|jarvi)\b|(?:^|[.!?]\s+)(?:jarvis|jervis)\b|\b(?:jarvis|jervis),)[\s,.!?-]*/i;

/**
 * The command in a transcript that may start with other people's talk: everything after the
 * first wake phrase ("...so anyway. Hey Jarvis, what's the weather?" → "what's the weather?").
 * Without a wake phrase, the text as-is (minus a leading wake phrase).
 */
export function commandAfterWakePhrase(text: string): { command: string; hadWakePhrase: boolean } {
  if (WAKE_PREFIX.test(text)) return { command: stripWakePhrase(text), hadWakePhrase: true };
  const m = WAKE_ANYWHERE.exec(text);
  if (!m) return { command: text.trim(), hadWakePhrase: false };
  return { command: text.slice(m.index + m[0].length).trim(), hadWakePhrase: true };
}

const JARVIS_WORD = /\b(?:jarvis|jervis|jarvas|jarves|charvis)\b/i;

/**
 * Borderline "hey Jarvis" confirmation: does the transcript mention Jarvis at all? (Its recording
 * starts ~2 s early, so other talk can come first.) 'wait' on a short partial live transcript;
 * after ~10 words without it, or on the whole utterance, 'no'. "Travis" etc. don't count.
 */
export function jarvisMentioned(text: string, final: boolean): 'yes' | 'no' | 'wait' {
  if (JARVIS_WORD.test(text)) return 'yes';
  if (final) return 'no';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= 10 ? 'no' : 'wait';
}
