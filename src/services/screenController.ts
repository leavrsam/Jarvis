// What the HUD "screen" shows, driven by Jarvis's SHOW_IMAGE / SHOW_VIDEO / SHOW_CAMERA /
// CLEAR_SCREEN directives. A tiny store the ScreenPanel component subscribes to.
import type { Directive } from './directives';

export type ScreenContent =
  | { kind: 'image'; url: string }
  | { kind: 'image-search'; query: string }
  | { kind: 'video'; url: string }
  | { kind: 'camera'; camera: string };

export interface ScreenState {
  content: ScreenContent | null;
  /** Changes on every SHOW_*, so the panel restarts even for the same URL */
  version: number;
}

/** Images and camera views close themselves after this long with no new screen directive */
export const SCREEN_IDLE_MS = 3 * 60 * 1000;

let state: ScreenState = { content: null, version: 0 };
const listeners = new Set<(s: ScreenState) => void>();

function set(next: ScreenState) {
  state = next;
  listeners.forEach((l) => {
    try {
      l(state);
    } catch (err) {
      console.warn('[Screen] listener failed:', err);
    }
  });
}

export function getScreenState(): ScreenState {
  return state;
}

export function subscribeScreen(listener: (s: ScreenState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function showOnScreen(content: ScreenContent) {
  set({ content, version: state.version + 1 });
}

export function clearScreen() {
  if (state.content) set({ content: null, version: state.version + 1 });
}

/** Apply a screen directive (returns false for directives that aren't for the screen) */
export function applyScreenDirective(d: Directive): boolean {
  switch (d.type) {
    case 'show-image':
      showOnScreen({ kind: 'image', url: d.url });
      return true;
    case 'show-image-search':
      showOnScreen({ kind: 'image-search', query: d.query });
      return true;
    case 'show-video':
      showOnScreen({ kind: 'video', url: d.url });
      return true;
    case 'show-camera':
      showOnScreen({ kind: 'camera', camera: d.camera });
      return true;
    case 'clear-screen':
      clearScreen();
      return true;
    default:
      return false;
  }
}
