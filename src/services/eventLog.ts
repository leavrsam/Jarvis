// Small in-memory log of listening decisions (echo ignored, interruption, voice ID result), shown
// in the VOICE ID panel so misfires on a device can be diagnosed without a debugger.

export interface ListeningEvent {
  at: number;
  kind: 'echo-ignored' | 'barge-in' | 'partial-ignored' | 'voice-id' | 'command';
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
