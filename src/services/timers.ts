// Kitchen-style timers Jarvis sets with SET_TIMER / CANCEL_TIMER.
//
// Each timer stores its end time (not a countdown), so it keeps time through anything the page
// is busy with and survives a reload: on load, a timer that ended while the page was closed
// rings straight away. Saved per device in localStorage.

export interface HudTimer {
  id: string;
  label: string;
  /** Date.now() when it ends */
  endsAt: number;
  durationMs: number;
  /** When it started ringing (undefined: still counting down) */
  firedAt?: number;
}

const STORAGE_KEY = 'jarvis_timers_v1';
const MAX_TIMERS = 12;

let timers: HudTimer[] = load();
const listeners = new Set<(t: HudTimer[]) => void>();

function load(): HudTimer[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is HudTimer =>
        t && typeof t.id === 'string' && typeof t.label === 'string' && Number.isFinite(t.endsAt) && Number.isFinite(t.durationMs)
    );
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  } catch {}
}

function set(next: HudTimer[]) {
  timers = next;
  save();
  listeners.forEach((l) => {
    try {
      l(timers);
    } catch (err) {
      console.warn('[Timers] listener failed:', err);
    }
  });
}

export function getTimers(): HudTimer[] {
  return timers;
}

export function subscribeTimers(listener: (t: HudTimer[]) => void): () => void {
  listeners.add(listener);
  listener(timers);
  return () => {
    listeners.delete(listener);
  };
}

/** Start a timer. A new timer with the same label as a running one replaces it. */
export function addTimer(seconds: number, label: string, now = Date.now()): HudTimer {
  const timer: HudTimer = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    endsAt: now + seconds * 1000,
    durationMs: seconds * 1000,
  };
  const others = timers.filter((t) => sameLabel(t.label, label) === false);
  set([...others, timer].slice(-MAX_TIMERS));
  return timer;
}

/** Case/space-insensitive label match ("Pasta " == "pasta") */
export function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** Which timers CANCEL_TIMER: <label|all> refers to: exact label first, else labels containing it */
export function matchTimers(list: HudTimer[], label: string | 'all'): HudTimer[] {
  if (label === 'all') return list;
  const exact = list.filter((t) => sameLabel(t.label, label));
  if (exact.length) return exact;
  const needle = label.toLowerCase().trim();
  return list.filter((t) => t.label.toLowerCase().includes(needle) || needle.includes(t.label.toLowerCase()));
}

/** Remove the timers a CANCEL_TIMER refers to; returns how many */
export function cancelTimers(label: string | 'all'): number {
  const gone = new Set(matchTimers(timers, label).map((t) => t.id));
  if (gone.size) set(timers.filter((t) => !gone.has(t.id)));
  return gone.size;
}

/** Dismiss (remove) one timer */
export function dismissTimer(id: string) {
  if (timers.some((t) => t.id === id)) set(timers.filter((t) => t.id !== id));
}

/** Dismiss every ringing timer; returns how many */
export function dismissRinging(): number {
  const ringing = timers.filter((t) => t.firedAt !== undefined).length;
  if (ringing) set(timers.filter((t) => t.firedAt === undefined));
  return ringing;
}

export function ringingTimers(): HudTimer[] {
  return timers.filter((t) => t.firedAt !== undefined);
}

/** Mark timers whose time is up as ringing; returns the ones that just started ringing */
export function fireDue(now = Date.now()): HudTimer[] {
  const due = timers.filter((t) => t.firedAt === undefined && t.endsAt <= now);
  if (due.length) set(timers.map((t) => (t.firedAt === undefined && t.endsAt <= now ? { ...t, firedAt: now } : t)));
  return due;
}

/** "pasta", "pasta and eggs", "pasta, eggs and rice" */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** What Jarvis says when timers are done */
export function doneAnnouncement(labels: string[]): string {
  const named = labels.filter((l) => l && l.toLowerCase() !== 'timer');
  if (named.length === 0) return labels.length > 1 ? 'Sir, your timers are done.' : 'Sir, your timer is done.';
  return `Sir, your ${joinLabels(named)} timer${labels.length > 1 ? 's are' : ' is'} done.`;
}

/** 0:42, 4:05, 1:02:30 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
