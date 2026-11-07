// Small in-memory log of listening decisions (echo ignored, interruption, voice ID result), shown
// in the VOICE ID panel so misfires on a device can be diagnosed without a debugger.

export interface ListeningEvent {
  at: number;
  kind: 'echo-ignored' | 'barge-in' | 'partial-ignored' | 'voice-id' | 'command' | 'heard' | 'recognizer';
  detail: string;
}

const MAX = 40;
const events: ListeningEvent[] = [];

export function logEvent(kind: ListeningEvent['kind'], detail: string) {
  events.unshift({ at: Date.now(), kind, detail });
  if (events.length > MAX) events.length = MAX;
}

export function getEvents(): ListeningEvent[] {
  return [...events];
}

/** Health of the browser's speech recognizer (the wake-word listener) */
export const recognizerStats = {
  supported: true,
  running: false,
  starts: 0,
  finalPhrases: 0,
  lastHeardAt: 0,
  lastError: '',
  lastErrorAt: 0,
  errorCounts: {} as Record<string, number>,
};
