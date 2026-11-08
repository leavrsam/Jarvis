import { describe, expect, it } from 'vitest';
import {
  WIDGETS,
  addWidget,
  clampRect,
  collapseWidget,
  expandWidget,
  findFreeSpot,
  isOnBoard,
  isShown,
  removeWidget,
  defaultRects,
  emptyLayout,
  fitRect,
  moveInOrder,
  parseLayout,
  resolveRects,
  TOP,
  withRect,
} from './hudLayout';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('defaultRects', () => {
  for (const vp of [
    { w: 1024, h: 768 },
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
    { w: 1920, h: 1080 },
    { w: 2560, h: 1440 },
  ]) {
    it(`fits ${vp.w}x${vp.h} on screen with no overlaps (except music, top centre)`, () => {
      const rects = defaultRects(vp);
      const ids = Object.keys(rects).filter((id) => id !== 'nowPlaying') as (keyof typeof rects)[];
      for (const id of ids) {
        const r = rects[id];
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(TOP);
        expect(r.x + r.w).toBeLessThanOrEqual(vp.w);
        expect(r.y + r.h).toBeLessThanOrEqual(vp.h);
        expect(r.h).toBeGreaterThanOrEqual(WIDGETS.find((w) => w.id === id)!.minH);
        for (const other of ids) if (other !== id) expect(overlap(r, rects[other])).toBe(false);
      }
    });
  }

  it('moves System under the conversation on short screens', () => {
    const r = defaultRects({ w: 1280, h: 720 });
    expect(r.system.x).toBe(r.conversation.x);
    const tall = defaultRects({ w: 1920, h: 1080 });
    expect(tall.system.x).toBe(tall.clock.x);
  });
});

describe('clampRect', () => {
  it('keeps widgets on screen, below the top bar and at least their minimum size', () => {
    const r = clampRect({ x: -50, y: 0, w: 10, h: 10 }, { w: 1280, h: 720 }, 'calendar');
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBe(TOP);
    expect(r.w).toBe(240);
    expect(r.h).toBe(150);
    const big = clampRect({ x: 900, y: 600, w: 5000, h: 5000 }, { w: 1280, h: 720 }, 'clock');
    expect(big.x + big.w).toBeLessThanOrEqual(1280);
    expect(big.y + big.h).toBeLessThanOrEqual(720);
  });
});

describe('fitRect', () => {
  it('keeps right-side widgets anchored to the right edge', () => {
    const r = fitRect({ x: 1450, y: 72, w: 440, h: 300 }, { w: 1920, h: 1080 }, { w: 1440, h: 1080 }, 'conversation');
    expect(1440 - (r.x + r.w)).toBe(1920 - (1450 + 440));
  });
  it('keeps left-side widgets where they are', () => {
    const r = fitRect({ x: 24, y: 72, w: 330, h: 200 }, { w: 1920, h: 1080 }, { w: 1440, h: 1080 }, 'weather');
    expect(r.x).toBe(24);
  });
  it('scales a stacked column so it stays stacked on a shorter screen', () => {
    const from = { w: 1440, h: 1080 };
    const to = { w: 1440, h: 800 };
    const top = fitRect({ x: 24, y: 72, w: 330, h: 400 }, from, to, 'calendar');
    const below = fitRect({ x: 24, y: 488, w: 330, h: 300 }, from, to, 'system');
    expect(below.y).toBeGreaterThanOrEqual(top.y + top.h);
  });
});

describe('saved layouts', () => {
  it('parses garbage safely', () => {
    expect(parseLayout('not json')).toEqual(emptyLayout());
    expect(parseLayout(null)).toEqual(emptyLayout());
    const l = parseLayout(JSON.stringify({ rects: { clock: { x: 'a' }, bogus: { x: 1, y: 1, w: 1, h: 1 } }, savedFor: { w: 1000, h: 800 }, hidden: ['clock', 'nope', 'clock'], order: ['system'] }));
    expect(l.rects).toEqual({});
    expect(l.hidden).toEqual(['clock']);
    expect(l.order[0]).toBe('system');
    expect(l.order).toHaveLength(5); // missing widgets appended
  });

  it('round-trips a moved widget and pins the rest where they were', () => {
    const vp = { w: 1440, h: 900 };
    const before = resolveRects(emptyLayout(), vp);
    const moved = withRect(emptyLayout(), vp, 'weather', { x: 600, y: 300, w: 400, h: 250 });
    const after = resolveRects(parseLayout(JSON.stringify(moved)), vp);
    expect(after.weather).toEqual({ x: 600, y: 300, w: 400, h: 250 });
    expect(after.clock).toEqual(before.clock);
  });
});

describe('moveInOrder', () => {
  it('swaps neighbours and ignores moves off the ends', () => {
    expect(moveInOrder(['clock', 'weather', 'system'], 'weather', -1)).toEqual(['weather', 'clock', 'system']);
    expect(moveInOrder(['clock', 'weather'], 'clock', -1)).toEqual(['clock', 'weather']);
    expect(moveInOrder(['clock', 'weather'], 'weather', 1)).toEqual(['clock', 'weather']);
  });
  it('skips hidden widgets', () => {
    expect(moveInOrder(['clock', 'system', 'weather'], 'weather', -1, ['system'])).toEqual(['weather', 'system', 'clock']);
  });
});

describe('widget library', () => {
  const vp = { w: 1920, h: 1080 };

  it('starts with the original widgets on the board and library widgets off it', () => {
    const l = emptyLayout();
    expect(isOnBoard(l, 'clock')).toBe(true);
    expect(isOnBoard(l, 'camera')).toBe(false);
  });

  it('removes and re-adds default and library widgets', () => {
    let l = removeWidget(emptyLayout(), 'calendar');
    expect(isOnBoard(l, 'calendar')).toBe(false);
    l = addWidget(l, 'calendar', vp);
    expect(isOnBoard(l, 'calendar')).toBe(true);
    l = addWidget(l, 'notes', vp);
    expect(isOnBoard(l, 'notes')).toBe(true);
    expect(l.order).toContain('notes');
    l = removeWidget(l, 'notes');
    expect(isOnBoard(l, 'notes')).toBe(false);
  });

  it('places an added widget in free space without covering the defaults', () => {
    let l = emptyLayout();
    for (const id of ['camera', 'quickCommands', 'countdown'] as const) l = addWidget(l, id, vp);
    const rects = resolveRects(l, vp);
    const onBoard = WIDGETS.filter((w) => isOnBoard(l, w.id) && w.id !== 'nowPlaying').map((w) => w.id);
    for (const a of ['camera', 'quickCommands', 'countdown'] as const) {
      const r = rects[a];
      expect(r.x + r.w).toBeLessThanOrEqual(vp.w);
      expect(r.y + r.h).toBeLessThanOrEqual(vp.h);
      for (const b of onBoard) if (b !== a) expect(overlap(r, rects[b])).toBe(false);
    }
  });

  it('minimises to the dock and restores', () => {
    let l = collapseWidget(emptyLayout(), 'weather');
    expect(isOnBoard(l, 'weather')).toBe(true);
    expect(isShown(l, 'weather')).toBe(false);
    l = expandWidget(l, 'weather');
    expect(isShown(l, 'weather')).toBe(true);
    // Removing a minimised widget also clears it from the dock
    l = removeWidget(collapseWidget(l, 'weather'), 'weather');
    expect(l.collapsed).not.toContain('weather');
  });

  it('keeps added/minimised widgets through save and load', () => {
    const l = collapseWidget(addWidget(emptyLayout(), 'sunMoon', vp), 'sunMoon');
    const back = parseLayout(JSON.stringify(l));
    expect(back.added).toEqual(['sunMoon']);
    expect(back.collapsed).toEqual(['sunMoon']);
    expect(parseLayout(JSON.stringify({ ...l, added: ['clock', 'bogus'] })).added).toEqual([]);
  });

  it('falls back to the middle when nothing is free', () => {
    const full = [{ x: 0, y: 0, w: 4000, h: 4000 }];
    const r = findFreeSpot(full, { w: 300, h: 200 }, vp);
    expect(r.w).toBe(300);
    expect(r.x).toBeGreaterThan(0);
  });
});

import { moonName, moonPhase } from '../components/hud/ExtraWidgets';

describe('moon phase', () => {
  it('matches known new and full moons', () => {
    expect(moonName(moonPhase(new Date(Date.UTC(2024, 0, 25, 17, 54))))).toBe('Full moon');
    expect(moonName(moonPhase(new Date(Date.UTC(2024, 1, 9, 22, 59))))).toBe('New moon');
    expect(moonName(moonPhase(new Date(Date.UTC(2024, 1, 16, 15, 1))))).toBe('First quarter');
  });
});
