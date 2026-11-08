import { describe, expect, it } from 'vitest';
import {
  WIDGETS,
  WidgetId,
  clampRect,
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
      const ids = Object.keys(rects).filter((id) => id !== 'nowPlaying') as WidgetId[];
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
