// Radio / audio-stream player (PLAY_RADIO: <what>, PLAY_STREAM: <https url> | <title>).
//
// Plays through a plain <audio> element, which phones keep playing with the screen off or Jarvis
// in the background (unlike YouTube's embedded player), with lock-screen / notification
// controls via the Media Session API. Ducks while Jarvis talks, like the YouTube player.
import { Station, reportStationPlay, searchStations } from './radio';
import { subscribeDuck } from './youtubeController';

export type StreamSource = 'radio' | 'stream';

export interface StreamState {
  source: StreamSource | null;
  playing: boolean;
  paused: boolean;
  loading: boolean;
  title: string;
  subtitle: string;
  url: string;
  artwork: string;
  volume: number;
  muted: boolean;
  ducked: boolean;
  /** Another station is available for "next" */
  canNext: boolean;
  /** What went wrong (no station found, blocked autoplay, ...) */
  error: string;
}

const START_TIMEOUT_MS = 9000;
const MAX_TRIES = 6;
const DUCK_FACTOR = 0.2;

let audio: HTMLAudioElement | null = null;
let userVolume = 100;
let duckRequested = false;
let state: StreamState = blank();
let stations: Station[] = [];
let stationIndex = 0;
let query = '';
let attempt = 0; // bumps on every new start, so stale attempts give up
const listeners = new Set<(s: StreamState) => void>();

function blank(): StreamState {
  return { source: null, playing: false, paused: false, loading: false, title: '', subtitle: '', url: '', artwork: '', volume: userVolume, muted: false, ducked: false, canNext: false, error: '' };
}

function set(patch: Partial<StreamState>) {
  state = { ...state, ...patch, volume: userVolume, ducked: duckRequested && Boolean(state.source || patch.source) };
  for (const l of listeners) {
    try {
      l(state);
    } catch {}
  }
  updateMediaSession();
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.setAttribute('playsinline', '');
  audio.addEventListener('playing', () => set({ playing: true, paused: false, loading: false, error: '' }));
  audio.addEventListener('pause', () => {
    if (state.source && !state.loading) set({ playing: false, paused: true });
  });
  audio.addEventListener('waiting', () => {
    if (state.playing) set({ loading: true });
  });
  // A stream that drops mid-play: reconnect once, then try the next station
  let reconnectedAt = 0;
  audio.addEventListener('error', () => {
    if (!state.source || state.loading || !state.playing) return;
    const now = Date.now();
    if (now - reconnectedAt > 60_000) {
      reconnectedAt = now;
      void startUrl(state.url, ++attempt);
    } else if (state.source === 'radio') {
      void next();
    } else {
      set({ playing: false, paused: true, error: 'The stream stopped.' });
    }
  });
  applyVolume();
  return audio;
}

function applyVolume() {
  if (!audio) return;
  // iPhones ignore volume set by a web page (hardware buttons only); elsewhere this works
  audio.volume = Math.max(0, Math.min(1, (userVolume / 100) * (duckRequested ? DUCK_FACTOR : 1)));
}

/** Play one address; resolves true once audio is actually playing */
function startUrl(url: string, myAttempt: number): Promise<boolean> {
  const a = el();
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('error', onError);
      resolve(ok && myAttempt === attempt);
    };
    const onPlaying = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), START_TIMEOUT_MS);
    a.addEventListener('playing', onPlaying);
    a.addEventListener('error', onError);
    a.src = url;
    applyVolume();
    a.play().catch((err: Error) => {
      if (err?.name === 'NotAllowedError') {
        // The browser wants a tap before sound starts (no recent interaction with the page)
        done = true;
        clearTimeout(timer);
        a.removeEventListener('playing', onPlaying);
        a.removeEventListener('error', onError);
        set({ loading: false, playing: false, paused: true, error: 'Tap play to start (the browser needs a tap first).' });
        resolve(true);
      } else {
        finish(false);
      }
    });
  });
}

/** Try stations from `from` until one plays */
async function playFrom(from: number): Promise<void> {
  const myAttempt = ++attempt;
  for (let i = 0; i < Math.min(MAX_TRIES, stations.length); i++) {
    const idx = (from + i) % stations.length;
    const s = stations[idx];
    stationIndex = idx;
    set({ source: 'radio', loading: true, playing: false, paused: false, title: s.name, subtitle: describe(s), url: s.url, artwork: s.favicon, canNext: stations.length > 1, error: '' });
    const ok = await startUrl(s.url, myAttempt);
    if (myAttempt !== attempt) return; // something else started meanwhile
    if (ok) {
      if (state.error) return; // waiting for a tap
      reportStationPlay(s.id);
      return;
    }
  }
  if (myAttempt === attempt) {
    stopAudio();
    set({ loading: false, playing: false, paused: false, error: `Couldn't start a station for "${query}".` });
  }
}

function describe(s: Station): string {
  const tags = s.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  return [s.country, tags].filter(Boolean).join(' · ');
}

function stopAudio() {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

// ---------------------------------------------------------------------------- public API

/** PLAY_RADIO: <what>: find stations ("lofi", "jazz", "BBC Radio 1") and play the best that works */
export async function playRadio(what: string): Promise<void> {
  query = what.trim();
  const myAttempt = ++attempt;
  set({ source: 'radio', loading: true, playing: false, paused: false, title: `Finding "${query}"…`, subtitle: 'Internet radio', url: '', artwork: '', canNext: false, error: '' });
  try {
    stations = await searchStations(query);
  } catch {
    stations = [];
  }
  if (myAttempt !== attempt) return;
  if (!stations.length) {
    set({ loading: false, error: `No radio station found for "${query}".` });
    return;
  }
  await playFrom(0);
}

/** PLAY_STREAM: <https url> | <title> */
export async function playStream(url: string, title?: string): Promise<void> {
  stations = [];
  query = '';
  const myAttempt = ++attempt;
  set({ source: 'stream', loading: true, playing: false, paused: false, title: title || 'Audio stream', subtitle: new URL(url).host, url, artwork: '', canNext: false, error: '' });
  const ok = await startUrl(url, myAttempt);
  if (myAttempt === attempt && !ok) {
    stopAudio();
    set({ loading: false, playing: false, error: "That stream wouldn't play." });
  }
}

export function pause() {
  if (!state.source) return;
  audio?.pause();
  set({ playing: false, paused: true, loading: false });
}

export function resume() {
  if (!state.source) return;
  if (!audio?.src) {
    void (state.source === 'radio' && stations.length ? playFrom(stationIndex) : playStream(state.url, state.title));
    return;
  }
  void audio.play().then(
    () => set({ error: '' }),
    () => set({ error: 'Tap play to start.' })
  );
}

export function togglePlayPause() {
  if (state.playing) pause();
  else resume();
}

export function stop() {
  attempt++;
  stopAudio();
  stations = [];
  set({ ...blank() });
}

/** Next station for the same request */
export async function next(): Promise<void> {
  if (state.source !== 'radio' || stations.length < 2) return;
  await playFrom((stationIndex + 1) % stations.length);
}

export async function previous(): Promise<void> {
  if (state.source !== 'radio' || stations.length < 2) return;
  await playFrom((stationIndex - 1 + stations.length) % stations.length);
}

export function setVolume(v: number) {
  userVolume = Math.max(0, Math.min(100, Math.round(v)));
  applyVolume();
  set({});
}

export function toggleMute() {
  if (!audio) return;
  audio.muted = !audio.muted;
  set({ muted: audio.muted });
}

export function isActive(): boolean {
  return state.source !== null;
}

export function getStreamState(): StreamState {
  return state;
}

export function subscribeStream(listener: (s: StreamState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

// Duck with everything else while Jarvis talks / listens
subscribeDuck((ducked) => {
  duckRequested = ducked;
  applyVolume();
  if (state.source) set({});
});

// ---------------------------------------------------------------------------- lock screen / notification controls

function updateMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (!state.source) {
    ms.metadata = null;
    ms.playbackState = 'none';
    return;
  }
  try {
    ms.metadata = new MediaMetadata({
      title: state.title,
      artist: state.subtitle || 'Jarvis',
      album: state.source === 'radio' ? 'Jarvis radio' : 'Jarvis',
      artwork: [
        ...(state.artwork ? [{ src: state.artwork }] : []),
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    ms.playbackState = state.playing ? 'playing' : 'paused';
  } catch {}
}

if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', resume],
    ['pause', pause],
    ['stop', stop],
    ['nexttrack', () => void next()],
    ['previoustrack', () => void previous()],
  ];
  for (const [action, fn] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, () => {
        if (state.source) fn();
      });
    } catch {}
  }
}
