// Small in-memory log of listening decisions (echo ignored, interruption, voice ID result), shown
// in the VOICE ID panel so misfires on a device can be diagnosed without a debugger.

export interface ListeningEvent {
  at: number;
  kind: 'echo-ignored' | 'barge-in' | 'partial-ignored' | 'voice-id' | 'command' | 'heard' | 'recognizer' | 'wake';
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

/** Health of the built-in listener ("hey Jarvis" detector + cloud transcription) */
export const builtInStats = {
  active: false,
  modelStatus: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  modelError: '',
  /** Highest wake word score in the last ~2 s (for the meter) */
  recentScore: 0,
  detections: 0,
  transcriptions: 0,
  lastTranscriptMs: 0,
  lastError: '',
  state: 'standby' as 'standby' | 'capturing' | 'transcribing',
};
