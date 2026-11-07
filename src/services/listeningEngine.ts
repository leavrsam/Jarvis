// Which listening engine the app uses:
// - 'builtin': on-device "hey Jarvis" detector + Deepgram transcription, one shared mic stream.
//   Works in Fully Kiosk / Android WebView and on phones that won't share the mic.
// - 'browser': the browser's own speech recognizer (Chrome desktop, etc.).
export type ListeningEngine = 'builtin' | 'browser';

const KEY = 'jarvis_listening_engine';
const EVENT = 'jarvis:listening-engine';

export function getListeningEngine(): ListeningEngine {
  try {
    return localStorage.getItem(KEY) === 'browser' ? 'browser' : 'builtin';
  } catch {
    return 'builtin';
  }
}

export function setListeningEngine(engine: ListeningEngine) {
  try {
    localStorage.setItem(KEY, engine);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function onListeningEngineChange(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
