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
