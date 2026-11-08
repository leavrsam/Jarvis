// Layout of the HUD's widgets: where each one sits on wide screens, which are hidden, and their
// order in the phone/tablet stack. Saved per device in localStorage.
// Pure logic (no React), so it can be unit tested.

export type WidgetId = 'clock' | 'weather' | 'calendar' | 'nowPlaying' | 'system' | 'conversation';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface HudLayout {
  /** Wide-screen positions, in px, as placed on the viewport `savedFor` */
  rects: Partial<Record<WidgetId, Rect>>;
  savedFor: Viewport | null;
  hidden: WidgetId[];
  /** Order of the phone/tablet stack */
  order: WidgetId[];
}

export const WIDGETS: { id: WidgetId; label: string; minW: number; minH: number; mobile: boolean }[] = [
  { id: 'clock', label: 'Clock', minW: 220, minH: 110, mobile: true },
  { id: 'weather', label: 'Weather', minW: 240, minH: 120, mobile: true },
  { id: 'calendar', label: 'Calendar', minW: 240, minH: 150, mobile: true },
  { id: 'nowPlaying', label: 'Now playing', minW: 240, minH: 80, mobile: true },
  { id: 'system', label: 'System', minW: 240, minH: 150, mobile: true },
  // Phones use the subtitles + logs at the bottom of the voice screen instead
  { id: 'conversation', label: 'Conversation', minW: 300, minH: 260, mobile: false },
];

export const widgetInfo = (id: WidgetId) => WIDGETS.find((w) => w.id === id)!;

/** Space kept clear for the top bar */
export const TOP = 64;
export const MARGIN = 8;
export const GRID = 8;

const STORAGE_KEY = 'jarvis_hud_layout_v1';
const DEFAULT_ORDER: WidgetId[] = ['clock', 'weather', 'calendar', 'nowPlaying', 'system'];

export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** The original layout: cards down the left, conversation on the right, music top centre */
export function defaultRects(vp: Viewport): Record<WidgetId, Rect> {
  const top = 72;
  const side = 24;
  const gap = 16;
  const colW = 330;
  const convW = Math.min(440, Math.max(340, vp.w - colW - 3 * side - 200));
  const avail = vp.h - top - side;

  // Heights the cards need to show everything. The calendar takes what's left of the column.
  const clock = 152;
  const weather = 192;
  const systemFull = 304;
  const minCal = 200;
  const convX = vp.w - side - convW;
  let system = systemFull;
  let systemOnRight = false;
  let cal = avail - clock - weather - system - 3 * gap;
  if (cal < minCal) {
    // A little short: let System scroll inside. Much too short (laptops): System moves to the
    // bottom of the right column, under a shorter conversation.
    system = avail - clock - weather - minCal - 3 * gap;
    if (system < 260) {
      systemOnRight = true;
      system = systemFull;
      cal = avail - clock - weather - 2 * gap;
    } else {
      cal = minCal;
    }
  }
  let y = top;
  const stack = (h: number): Rect => {
    const r = { x: side, y, w: colW, h };
    y += h + gap;
    return r;
  };
  const npW = 340;
  const rects = {
    clock: stack(clock),
    weather: stack(weather),
    calendar: stack(cal),
    system: systemOnRight ? { x: convX, y: top + avail - systemFull, w: convW, h: systemFull } : stack(system),
    conversation: { x: convX, y: top, w: convW, h: systemOnRight ? avail - systemFull - gap : avail },
    nowPlaying: { x: Math.round((side + colW + convX) / 2 - npW / 2), y: top, w: npW, h: 96 },
  };
  return rects;
}

/** Keep a rect on screen and at least its widget's minimum size */
export function clampRect(r: Rect, vp: Viewport, id: WidgetId): Rect {
  const { minW, minH } = widgetInfo(id);
  const maxW = Math.max(minW, vp.w - 2 * MARGIN);
  const maxH = Math.max(minH, vp.h - TOP - MARGIN);
  const w = Math.min(Math.max(r.w, minW), maxW);
  const h = Math.min(Math.max(r.h, minH), maxH);
  const x = Math.min(Math.max(r.x, MARGIN), Math.max(MARGIN, vp.w - w - MARGIN));
  const y = Math.min(Math.max(r.y, TOP), Math.max(TOP, vp.h - h - MARGIN));
  return { x, y, w, h };
}

/**
 * A rect placed on one screen size, moved to another. Horizontally, widgets on the right half
 * keep their distance from the right edge (left half: from the left), so columns stay put and
 * cards keep their width. Vertically, positions and heights scale with the usable height, so
 * widgets stacked in a column stay stacked without overlapping. Then it's clamped on screen.
 */
export function fitRect(r: Rect, from: Viewport, to: Viewport, id: WidgetId): Rect {
  let { x, y, h } = r;
  if (to.w !== from.w && x + r.w / 2 > from.w / 2) x += to.w - from.w;
  if (to.h !== from.h) {
    const k = (to.h - TOP) / Math.max(1, from.h - TOP);
    y = TOP + (y - TOP) * k;
    h = h * k;
  }
  return clampRect({ x: Math.round(x), y: Math.round(y), w: r.w, h: Math.round(h) }, to, id);
}

/** Where every widget goes on this screen */
export function resolveRects(layout: HudLayout, vp: Viewport): Record<WidgetId, Rect> {
  const defaults = defaultRects(vp);
  const out = {} as Record<WidgetId, Rect>;
  for (const { id } of WIDGETS) {
    const saved = layout.rects[id];
    out[id] = saved && layout.savedFor ? fitRect(saved, layout.savedFor, vp, id) : clampRect(defaults[id], vp, id);
  }
  return out;
}

/** Store every widget's current rect for this screen (so later screen-size changes fit from here) */
export function withRect(layout: HudLayout, vp: Viewport, id: WidgetId, rect: Rect): HudLayout {
  const current = resolveRects(layout, vp);
  return { ...layout, rects: { ...current, [id]: clampRect(rect, vp, id) }, savedFor: { ...vp } };
}

export function emptyLayout(): HudLayout {
  return { rects: {}, savedFor: null, hidden: [], order: [...DEFAULT_ORDER] };
}

const isId = (v: unknown): v is WidgetId => typeof v === 'string' && WIDGETS.some((w) => w.id === v);
const isRect = (v: unknown): v is Rect =>
  !!v && typeof v === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

/** Parse saved JSON, dropping anything malformed; unknown/missing widgets fall back to defaults */
export function parseLayout(raw: string | null): HudLayout {
  const base = emptyLayout();
  if (!raw) return base;
  try {
    const d = JSON.parse(raw);
    const rects: HudLayout['rects'] = {};
    if (d?.rects && typeof d.rects === 'object') {
      for (const [k, v] of Object.entries(d.rects)) if (isId(k) && isRect(v)) rects[k] = v;
    }
    const savedFor =
      d?.savedFor && Number.isFinite(d.savedFor.w) && Number.isFinite(d.savedFor.h) && d.savedFor.w > 0 && d.savedFor.h > 0
        ? { w: d.savedFor.w, h: d.savedFor.h }
        : null;
    const hidden = Array.isArray(d?.hidden) ? [...new Set(d.hidden.filter(isId))] as WidgetId[] : [];
    const order = Array.isArray(d?.order) ? ([...new Set(d.order.filter(isId))] as WidgetId[]) : [];
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    return { rects: savedFor ? rects : {}, savedFor, hidden, order };
  } catch {
    return base;
  }
}

export function loadLayout(): HudLayout {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyLayout();
  }
}

export function saveLayout(layout: HudLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

/**
 * Move a widget up (-1) or down (+1) in the phone stack, past the next widget that's shown
 * (hidden ones in between keep their place).
 */
export function moveInOrder(order: WidgetId[], id: WidgetId, dir: -1 | 1, hidden: WidgetId[] = []): WidgetId[] {
  const i = order.indexOf(id);
  let j = i + dir;
  while (j >= 0 && j < order.length && hidden.includes(order[j])) j += dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
