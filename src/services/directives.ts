// Directives Jarvis puts at the start of a reply (one per line) to control the HUD.
// They are executed, never spoken or shown in the subtitles.
//
//   PLAY_YOUTUBE: <11-char video id>      PLAY_YOUTUBE_PLAYLIST: <playlist id>
//   PAUSE_YOUTUBE / RESUME_YOUTUBE / STOP_YOUTUBE / NEXT_YOUTUBE / PREV_YOUTUBE / SET_VOLUME: <0-100>
//   SHOW_IMAGE_SEARCH: <what to show>     (the app finds a real photo; Jarvis doesn't need a URL)
//   SHOW_IMAGE: <https url>               SHOW_VIDEO: <https url to an mp4/webm file>
//   SHOW_CAMERA: <camera name>            CLEAR_SCREEN
//   SET_TIMER: <seconds> | <label>        CANCEL_TIMER: <label or "all">
//
// Pure logic (no DOM), shared by the reply stream parser and the HUD screen.

export type Directive =
  | { type: 'youtube-video'; videoId: string }
  | { type: 'youtube-playlist'; playlistId: string }
  | { type: 'youtube-control'; action: 'pause' | 'resume' | 'stop' | 'next' | 'prev' }
  | { type: 'set-volume'; volume: number }
  | { type: 'show-image'; url: string }
  | { type: 'show-image-search'; query: string }
  | { type: 'show-video'; url: string }
  | { type: 'show-camera'; camera: string }
  | { type: 'clear-screen' }
  | { type: 'set-timer'; seconds: number; label: string }
  | { type: 'cancel-timer'; label: string | 'all' };

/** Every directive keyword (used while a reply is still streaming in) */
export const DIRECTIVE_KEYWORDS = [
  'PLAY_YOUTUBE_PLAYLIST',
  'PLAY_YOUTUBE',
  'PAUSE_YOUTUBE',
  'RESUME_YOUTUBE',
  'STOP_YOUTUBE',
  'NEXT_YOUTUBE',
  'YOUTUBE_NEXT',
  'PREV_YOUTUBE',
  'PREVIOUS_YOUTUBE',
  'YOUTUBE_PREV',
  'SET_VOLUME',
  'SHOW_IMAGE_SEARCH',
  'SHOW_IMAGE',
  'SHOW_VIDEO',
  'SHOW_CAMERA',
  'CLEAR_SCREEN',
  'SET_TIMER',
  'CANCEL_TIMER',
];
/** Keywords followed by ": <argument>" */
export const ARG_KEYWORDS = new Set(['PLAY_YOUTUBE_PLAYLIST', 'PLAY_YOUTUBE', 'SET_VOLUME', 'SHOW_IMAGE', 'SHOW_IMAGE_SEARCH', 'SHOW_VIDEO', 'SHOW_CAMERA', 'SET_TIMER', 'CANCEL_TIMER']);

// One alternation, used anchored (leading directive) and global (stripping / late directives).
// URLs run to the next whitespace; a camera name runs to the end of its line.
const DIRECTIVE_SOURCE =
  String.raw`PLAY_YOUTUBE_PLAYLIST:\s*\[?[A-Za-z0-9_-]+\]?` +
  String.raw`|PLAY_YOUTUBE:\s*\[?[A-Za-z0-9_-]+\]?` +
  String.raw`|SET_VOLUME:\s*\d{1,3}` +
  String.raw`|SHOW_IMAGE_SEARCH:[ \t]*[^\n]*[^\s]` +
  String.raw`|SHOW_IMAGE:[ \t]*\S+` +
  String.raw`|SHOW_VIDEO:[ \t]*\S+` +
  String.raw`|SHOW_CAMERA:[ \t]*[^\n]*[^\s]` +
  String.raw`|SET_TIMER:[ \t]*[^\n]*[^\s]` +
  String.raw`|CANCEL_TIMER:[ \t]*[^\n]*[^\s]` +
  String.raw`|\b(?:PAUSE_YOUTUBE|RESUME_YOUTUBE|STOP_YOUTUBE|NEXT_YOUTUBE|YOUTUBE_NEXT|PREV_YOUTUBE|PREVIOUS_YOUTUBE|YOUTUBE_PREV|CLEAR_SCREEN)\b`;

export const LEADING_DIRECTIVE_RE = new RegExp(`^(?:${DIRECTIVE_SOURCE})`, 'i');
export const ANY_DIRECTIVE_RE = new RegExp(DIRECTIVE_SOURCE, 'gi');

/** True for an absolute https:// URL (the screen loads nothing else) */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Camera names: letters, digits, spaces and _ - . (passed to n8n as a query parameter) */
export function normalizeCameraName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  return /^[\w .-]{1,64}$/.test(name) ? name : null;
}

/** What to search for: plain words, up to 100 characters (brackets/quotes around it removed) */
export function normalizeImageQuery(value: string): string | null {
  const q = value
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || q.length > 100 || !/[\p{L}\p{N}]/u.test(q)) return null;
  return q;
}

/** Longest timer Jarvis can set (a day) */
export const MAX_TIMER_SECONDS = 24 * 60 * 60;

/** Timer label: plain words, up to 40 characters, without a trailing "timer" ("pasta timer" → "pasta") */
export function normalizeTimerLabel(value: string): string {
  const label = value
    .trim()
    .replace(/^["'“‘\[]+|["'”’\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\btimer\b\s*$/i, '')
    .trim()
    .slice(0, 40)
    .trim();
  return /[\p{L}\p{N}]/u.test(label) ? label : '';
}

/** Parse one directive string (e.g. "SHOW_IMAGE: https://..."). Null if it isn't a valid one. */
export function parseDirective(text: string): Directive | null {
  const t = text.trim();
  const m = /^([A-Z_]+)\s*(?::\s*(.*))?$/is.exec(t);
  if (!m) return null;
  const keyword = m[1].toUpperCase();
  const arg = (m[2] ?? '').trim().replace(/^\[(.*)\]$/, '$1').trim();

  switch (keyword) {
    case 'PLAY_YOUTUBE':
      return /^[A-Za-z0-9_-]{11}$/.test(arg) ? { type: 'youtube-video', videoId: arg } : null;
    case 'PLAY_YOUTUBE_PLAYLIST':
      return /^[A-Za-z0-9_-]+$/.test(arg) ? { type: 'youtube-playlist', playlistId: arg } : null;
    case 'PAUSE_YOUTUBE':
      return { type: 'youtube-control', action: 'pause' };
    case 'RESUME_YOUTUBE':
      return { type: 'youtube-control', action: 'resume' };
    case 'STOP_YOUTUBE':
      return { type: 'youtube-control', action: 'stop' };
    case 'NEXT_YOUTUBE':
    case 'YOUTUBE_NEXT':
      return { type: 'youtube-control', action: 'next' };
    case 'PREV_YOUTUBE':
    case 'PREVIOUS_YOUTUBE':
    case 'YOUTUBE_PREV':
      return { type: 'youtube-control', action: 'prev' };
    case 'SET_VOLUME': {
      if (!/^\d{1,3}$/.test(arg)) return null;
      return { type: 'set-volume', volume: Math.min(100, Number(arg)) };
    }
    case 'SHOW_IMAGE':
      return isHttpsUrl(arg) ? { type: 'show-image', url: arg } : null;
    case 'SHOW_IMAGE_SEARCH': {
      const query = normalizeImageQuery(arg);
      return query ? { type: 'show-image-search', query } : null;
    }
    case 'SHOW_VIDEO':
      return isHttpsUrl(arg) ? { type: 'show-video', url: arg } : null;
    case 'SHOW_CAMERA': {
      const camera = normalizeCameraName(arg);
      return camera ? { type: 'show-camera', camera } : null;
    }
    case 'CLEAR_SCREEN':
      return { type: 'clear-screen' };
    case 'SET_TIMER': {
      // "<seconds> | <label>"; the label is optional
      const [secs, ...rest] = arg.split('|');
      const seconds = Number(secs.trim());
      if (!/^\d+$/.test(secs.trim()) || seconds < 1 || seconds > MAX_TIMER_SECONDS) return null;
      return { type: 'set-timer', seconds, label: normalizeTimerLabel(rest.join('|')) || 'timer' };
    }
    case 'CANCEL_TIMER': {
      if (/^(?:all|everything|all timers)$/i.test(arg.trim())) return { type: 'cancel-timer', label: 'all' };
      const label = normalizeTimerLabel(arg);
      return label ? { type: 'cancel-timer', label } : null;
    }
    default:
      return null;
  }
}

/** Directives that drive the HUD screen (the rest go to the YouTube controller) */
export function isScreenDirective(
  d: Directive
): d is Extract<Directive, { type: 'show-image' | 'show-image-search' | 'show-video' | 'show-camera' | 'clear-screen' }> {
  return (
    d.type === 'show-image' ||
    d.type === 'show-image-search' ||
    d.type === 'show-video' ||
    d.type === 'show-camera' ||
    d.type === 'clear-screen'
  );
}
