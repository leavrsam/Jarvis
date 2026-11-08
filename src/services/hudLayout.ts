// Layout of the HUD's widgets: where each one sits on wide screens, which are hidden, and their
// order in the phone/tablet stack. Saved per device in localStorage.
// Pure logic (no React), so it can be unit tested.

/** The original widgets (on screen by default, with a hand-made default layout) */
export type CoreWidgetId = 'clock' | 'weather' | 'calendar' | 'nowPlaying' | 'system' | 'conversation';
/** Library widgets you add when you want them */
export type ExtraWidgetId =
  | 'camera'
  | 'quickCommands'
  | 'worldClocks'
  | 'airQuality'
  | 'sunMoon'
  | 'weekAhead'
  | 'countdown'
  | 'notes'
  | 'spectrum'
  | 'shopping'
  | 'tasks'
  | 'smartHome'
  | 'deliveries'
  | 'doorbell'
  | 'photoFrame'
  | 'headlines'
  | 'markets'
  | 'sports'
  | 'commute';
export type WidgetId = CoreWidgetId | ExtraWidgetId;

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
  /** Default widgets taken off the board (they wait in the widget library) */
  hidden: WidgetId[];
  /** Library widgets put on the board */
  added: WidgetId[];
  /** On the board but minimised to an icon in the dock */
  collapsed: WidgetId[];
  /** Order of the phone/tablet stack */
  order: WidgetId[];
}

export interface WidgetInfo {
  id: WidgetId;
  label: string;
  description: string;
  minW: number;
  minH: number;
  mobile: boolean;
  /** On the board until removed (the original widgets); others are added from the library */
  defaultOn: boolean;
  /** Starting size when added from the library */
  size: { w: number; h: number };
}

export const WIDGETS: WidgetInfo[] = [
  { id: 'clock', label: 'Clock', description: 'Time, date and a greeting.', minW: 220, minH: 110, mobile: true, defaultOn: true, size: { w: 330, h: 152 } },
  { id: 'weather', label: 'Weather', description: 'Now and the next six hours.', minW: 240, minH: 120, mobile: true, defaultOn: true, size: { w: 330, h: 192 } },
  { id: 'calendar', label: 'Calendar', description: "Today and tomorrow from your calendars.", minW: 240, minH: 150, mobile: true, defaultOn: true, size: { w: 330, h: 260 } },
  { id: 'nowPlaying', label: 'Now playing', description: 'Music Jarvis is playing, with controls.', minW: 240, minH: 80, mobile: true, defaultOn: true, size: { w: 340, h: 96 } },
  { id: 'system', label: 'System', description: 'Listening, timings, voice and voice ID.', minW: 240, minH: 150, mobile: true, defaultOn: true, size: { w: 330, h: 304 } },
  // Phones use the subtitles + logs at the bottom of the voice screen instead
  { id: 'conversation', label: 'Conversation', description: 'What you said and what Jarvis replied.', minW: 300, minH: 260, mobile: false, defaultOn: true, size: { w: 440, h: 600 } },
  { id: 'camera', label: 'Camera', description: 'A live snapshot from one of your cameras.', minW: 220, minH: 150, mobile: true, defaultOn: false, size: { w: 360, h: 250 } },
  { id: 'quickCommands', label: 'Quick commands', description: 'One-tap buttons that ask Jarvis something.', minW: 220, minH: 120, mobile: true, defaultOn: false, size: { w: 320, h: 220 } },
  { id: 'worldClocks', label: 'World clocks', description: 'The time in other cities.', minW: 200, minH: 110, mobile: true, defaultOn: false, size: { w: 300, h: 210 } },
  { id: 'airQuality', label: 'Air & UV', description: 'Air quality, pollution and UV index.', minW: 220, minH: 120, mobile: true, defaultOn: false, size: { w: 300, h: 200 } },
  { id: 'sunMoon', label: 'Sun & moon', description: 'Sunrise, sunset, daylight and the moon phase.', minW: 220, minH: 120, mobile: true, defaultOn: false, size: { w: 300, h: 200 } },
  { id: 'weekAhead', label: 'Week ahead', description: 'The next seven days from your calendars.', minW: 240, minH: 160, mobile: true, defaultOn: false, size: { w: 340, h: 340 } },
  { id: 'countdown', label: 'Countdown', description: 'Days until a date you choose.', minW: 200, minH: 110, mobile: true, defaultOn: false, size: { w: 280, h: 160 } },
  { id: 'notes', label: 'Note', description: 'A sticky note, saved on this device.', minW: 200, minH: 120, mobile: true, defaultOn: false, size: { w: 300, h: 220 } },
  { id: 'spectrum', label: 'Audio', description: 'A live audio spectrum of the mic and Jarvis.', minW: 220, minH: 90, mobile: true, defaultOn: false, size: { w: 360, h: 150 } },
  { id: 'shopping', label: 'Shopping list', description: 'Your household list from n8n; tick items off or add one.', minW: 220, minH: 150, mobile: true, defaultOn: false, size: { w: 300, h: 300 } },
  { id: 'tasks', label: 'Reminders', description: 'To-dos and reminders from n8n (e.g. Google Tasks).', minW: 220, minH: 140, mobile: true, defaultOn: false, size: { w: 300, h: 280 } },
  { id: 'smartHome', label: 'Smart home', description: 'Lights, plugs, locks and temperatures from n8n; tap to toggle.', minW: 240, minH: 140, mobile: true, defaultOn: false, size: { w: 340, h: 260 } },
  { id: 'deliveries', label: 'Deliveries', description: 'Packages on the way, from n8n.', minW: 220, minH: 120, mobile: true, defaultOn: false, size: { w: 300, h: 220 } },
  { id: 'doorbell', label: 'Doorbell log', description: 'Recent camera and doorbell events from n8n.', minW: 220, minH: 140, mobile: true, defaultOn: false, size: { w: 300, h: 280 } },
  { id: 'photoFrame', label: 'Photo frame', description: 'A slideshow: free photos of a topic, or your album via n8n.', minW: 200, minH: 140, mobile: true, defaultOn: false, size: { w: 380, h: 260 } },
  { id: 'headlines', label: 'Headlines', description: 'Top stories from news sources you pick.', minW: 240, minH: 160, mobile: true, defaultOn: false, size: { w: 340, h: 320 } },
  { id: 'markets', label: 'Markets', description: 'Stocks, indexes and crypto.', minW: 220, minH: 130, mobile: true, defaultOn: false, size: { w: 300, h: 230 } },
  { id: 'sports', label: 'Sports', description: 'Your teams: record, live score, next game.', minW: 240, minH: 130, mobile: true, defaultOn: false, size: { w: 340, h: 230 } },
  { id: 'commute', label: 'Commute', description: 'Drive time to a place you choose.', minW: 220, minH: 120, mobile: true, defaultOn: false, size: { w: 300, h: 170 } },
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
export function defaultRects(vp: Viewport): Record<CoreWidgetId, Rect> {
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
  const defaults = defaultRects(vp) as Partial<Record<WidgetId, Rect>>;
  const out = {} as Record<WidgetId, Rect>;
  const unplaced: WidgetId[] = [];
  for (const { id } of WIDGETS) {
    const saved = layout.rects[id];
    if (saved && layout.savedFor) out[id] = fitRect(saved, layout.savedFor, vp, id);
    else if (defaults[id]) out[id] = clampRect(defaults[id]!, vp, id);
    else unplaced.push(id);
  }
  // Library widgets with no saved place: the first free spot among what's on the board
  for (const id of unplaced) {
    const taken = WIDGETS.filter((w) => w.id !== id && isOnBoard(layout, w.id) && out[w.id]).map((w) => out[w.id]);
    out[id] = clampRect(findFreeSpot(taken, widgetInfo(id).size, vp), vp, id);
  }
  return out;
}

/** The centre of the screen, kept for the reactor when finding a place for a new widget */
function reactorZone(vp: Viewport): Rect {
  // The reactor's bright core, centred between the default columns (slightly left of centre)
  const size = Math.min(420, vp.w * 0.26, (vp.h - TOP) * 0.5);
  const cx = vp.w / 2 - 55;
  const cy = TOP + (vp.h - TOP) / 2;
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Where a new widget of `size` fits without covering others (scanning top-left to bottom-right),
 * avoiding the reactor in the middle if possible. Falls back to the middle of the screen.
 */
export function findFreeSpot(taken: Rect[], size: { w: number; h: number }, vp: Viewport): Rect {
  const step = 16;
  const tryPass = (avoid: Rect[]) => {
    for (let y = TOP + MARGIN; y + size.h <= vp.h - MARGIN; y += step) {
      for (let x = MARGIN + 16; x + size.w <= vp.w - MARGIN; x += step) {
        const r = { x, y, w: size.w, h: size.h };
        if (!avoid.some((o) => overlaps(r, o, 12))) return r;
      }
    }
    return null;
  };
  return (
    tryPass([...taken, reactorZone(vp)]) ??
    tryPass(taken) ?? { x: snap((vp.w - size.w) / 2), y: snap(TOP + (vp.h - TOP - size.h) / 2), ...size }
  );
}

// ---------------------------------------------------------------------------- board membership

/** Is the widget on the board (shown, or minimised in the dock)? */
export function isOnBoard(layout: HudLayout, id: WidgetId): boolean {
  return widgetInfo(id).defaultOn ? !layout.hidden.includes(id) : layout.added.includes(id);
}

/** On the board and not minimised */
export function isShown(layout: HudLayout, id: WidgetId): boolean {
  return isOnBoard(layout, id) && !layout.collapsed.includes(id);
}

/** Take a widget off the board (back to the library) */
export function removeWidget(layout: HudLayout, id: WidgetId): HudLayout {
  const next = { ...layout, collapsed: layout.collapsed.filter((c) => c !== id) };
  if (widgetInfo(id).defaultOn) next.hidden = [...layout.hidden.filter((h) => h !== id), id];
  else next.added = layout.added.filter((a) => a !== id);
  return next;
}

/** Put a widget on the board (from the library). On wide screens it gets a free spot. */
export function addWidget(layout: HudLayout, id: WidgetId, vp?: Viewport): HudLayout {
  let next: HudLayout = {
    ...layout,
    hidden: layout.hidden.filter((h) => h !== id),
    added: widgetInfo(id).defaultOn ? layout.added : [...layout.added.filter((a) => a !== id), id],
    collapsed: layout.collapsed.filter((c) => c !== id),
    order: layout.order.includes(id) ? layout.order : [...layout.order, id],
  };
  if (vp && !widgetInfo(id).defaultOn) {
    // Pin it where it lands now, so it doesn't jump when other widgets move later
    const { [id]: _drop, ...rest } = next.rects;
    void _drop;
    next = { ...next, rects: rest };
    next = withRect(next, vp, id, resolveRects(next, vp)[id]);
  }
  return next;
}

/** Minimise to an icon in the dock / restore */
export function collapseWidget(layout: HudLayout, id: WidgetId): HudLayout {
  return { ...layout, collapsed: [...layout.collapsed.filter((c) => c !== id), id] };
}

export function expandWidget(layout: HudLayout, id: WidgetId): HudLayout {
  return { ...layout, collapsed: layout.collapsed.filter((c) => c !== id) };
}

/** Store every widget's current rect for this screen (so later screen-size changes fit from here) */
export function withRect(layout: HudLayout, vp: Viewport, id: WidgetId, rect: Rect): HudLayout {
  const current = resolveRects(layout, vp);
  return { ...layout, rects: { ...current, [id]: clampRect(rect, vp, id) }, savedFor: { ...vp } };
}

export function emptyLayout(): HudLayout {
  return { rects: {}, savedFor: null, hidden: [], added: [], collapsed: [], order: [...DEFAULT_ORDER] };
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
    const ids = (v: unknown) => (Array.isArray(v) ? ([...new Set(v.filter(isId))] as WidgetId[]) : []);
    const hidden = ids(d?.hidden);
    const added = ids(d?.added).filter((id) => !widgetInfo(id).defaultOn);
    const collapsed = ids(d?.collapsed);
    const order = ids(d?.order);
    for (const id of [...DEFAULT_ORDER, ...added]) if (!order.includes(id)) order.push(id);
    return { rects: savedFor ? rects : {}, savedFor, hidden, added, collapsed, order };
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
