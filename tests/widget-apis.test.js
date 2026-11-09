import { describe, expect, it } from 'vitest';
import { cleanAction, normalizeFeed } from '../api/_lib/widgets/feed.js';
import { decode, parseFeed } from '../api/_lib/widgets/news.js';
import { parseChart } from '../api/_lib/widgets/markets.js';
import { parseTeam } from '../api/_lib/widgets/sports.js';
import { parseLatLon } from '../api/_lib/widgets/commute.js';
import { routeOf } from '../api/widgets.js';

describe('n8n feeds', () => {
  it('normalises the shopping list, dropping junk and unknown fields', () => {
    const out = normalizeFeed('shopping', { items: [{ id: 1, name: 'Gloves', qty: 2, checked: false, secret: 'x' }, { json: { name: 'Milk', done: true } }, { qty: 3 }] });
    expect(out.items).toEqual([
      { id: '1', name: 'Gloves', checked: false, qty: '2', addedBy: '', byGuest: null },
      { id: '1', name: 'Milk', checked: true, qty: '', addedBy: '', byGuest: null },
    ]);
  });

  it('marks guest additions instead of keeping a note in the text', () => {
    const { items } = normalizeFeed('shopping', {
      items: [
        { id: 'a', name: 'Better gloves (added by guest)' },
        { id: 'b', name: 'Chips - added by Sarah' },
        { id: 'c', name: 'Salsa [guest]' },
        { id: 'd', name: 'Eggs', addedBy: 'Samuel', addedByOwner: true },
        { id: 'e', name: 'Soda', addedBy: 'Guest #2', addedByOwner: false },
        { id: 'f', name: 'Bread', addedBy: 'Samuel' },
        { id: 'g', name: 'Guest towels' },
      ],
    });
    expect(items.map((i) => [i.name, i.addedBy, i.byGuest])).toEqual([
      ['Better gloves', '', true],
      ['Chips', 'Sarah', true],
      ['Salsa', '', true],
      ['Eggs', 'Samuel', false],
      ['Soda', 'Guest #2', true],
      ['Bread', 'Samuel', null],
      ['Guest towels', '', null],
    ]);
    expect(normalizeFeed('tasks', { tasks: [{ id: 't', title: 'Fix the sink (added by guest)' }] }).tasks[0]).toMatchObject({ title: 'Fix the sink', byGuest: true });
  });

  it('normalises the portfolio: percentages only, biggest holdings first, dollar fields dropped', () => {
    const out = normalizeFeed('portfolio', [
      {
        json: {
          updatedAt: '2026-11-09T15:00:00Z',
          totalGainPct: '12.345',
          cashPct: 4.2,
          totalValue: 123456,
          positions: [
            { id: 'p1', symbol: 'aapl', name: 'Apple', weightPct: 10, gainPct: -3.5, marketValue: 5000 },
            { id: 'p2', symbol: 'VTI', name: 'Total Market', weightPct: 40.5, gainPct: 22 },
            { name: '', symbol: '' },
          ],
        },
      },
    ]);
    expect(out).toEqual({
      updatedAt: '2026-11-09T15:00:00.000Z',
      totalGainPct: 12.35,
      cashPct: 4.2,
      positions: [
        { id: 'p2', symbol: 'VTI', name: 'Total Market', weightPct: 40.5, gainPct: 22 },
        { id: 'p1', symbol: 'AAPL', name: 'Apple', weightPct: 10, gainPct: -3.5 },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/marketValue|totalValue|5000|123456/);
  });

  it('normalises smart-home devices; sensors are never controllable', () => {
    const { devices } = normalizeFeed('home', {
      devices: [
        { id: 'l1', name: 'Kitchen', type: 'light', state: 'on', room: 'Kitchen' },
        { id: 't1', name: 'Thermostat', type: 'thermostat', value: '70', unit: '°F' },
        { id: 's1', name: 'Garage temp', type: 'sensor', value: 54 },
        { id: 'x', name: 'Weird', type: 'rocket' },
      ],
    });
    expect(devices.map((d) => [d.type, d.controllable])).toEqual([['light', true], ['thermostat', true], ['sensor', false], ['switch', true]]);
    expect(devices[1].value).toBe(70);
  });

  it('only keeps https links (photos, deliveries, doorbell images)', () => {
    expect(normalizeFeed('photos', { photos: [{ url: 'https://a.b/1.jpg' }, { url: 'http://a.b/2.jpg' }, { url: 'javascript:alert(1)' }] }).photos).toEqual([{ url: 'https://a.b/1.jpg', caption: '' }]);
    expect(normalizeFeed('deliveries', { packages: [{ title: 'Boots', url: 'data:text/html,x', eta: '2026-11-10' }] }).packages[0]).toMatchObject({ url: '', eta: '2026-11-10' });
    expect(normalizeFeed('doorbell', { events: [{ time: 'not a time' }, { time: '2026-11-08T20:00:00Z', camera: 'front door', imageUrl: 'http://x' }] }).events).toEqual([
      { id: '1', time: '2026-11-08T20:00:00.000Z', camera: 'front door', label: '', imageUrl: '' },
    ]);
  });

  it('accepts only known actions with the fields they need', () => {
    expect(cleanAction('shopping', { action: 'check', id: '7', checked: true, extra: 'drop me' })).toEqual({ action: 'check', id: '7', checked: true });
    expect(cleanAction('shopping', { action: 'add', name: 'Eggs' })).toEqual({ action: 'add', name: 'Eggs' });
    expect(cleanAction('shopping', { action: 'add' })).toBeNull();
    expect(cleanAction('shopping', { action: 'delete_everything' })).toBeNull();
    expect(cleanAction('home', { action: 'set', id: 't1', value: 'warm' })).toBeNull();
    expect(cleanAction('home', { action: 'set', id: 't1', value: 68 })).toEqual({ action: 'set', id: 't1', value: 68 });
    expect(cleanAction('deliveries', { action: 'check', id: '1' })).toBeNull();
  });
});

describe('headlines', () => {
  it('parses RSS with CDATA and entities', () => {
    const xml = `<rss><channel><item><title><![CDATA[Rain &amp; wind <b>today</b>]]></title><link>https://x.org/a</link><pubDate>Sun, 08 Nov 2026 20:00:00 GMT</pubDate></item>
      <item><title>Q&#39;s &quot;plan&quot;</title><link>http://insecure.org/b</link></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      { title: 'Rain & wind today', link: 'https://x.org/a', published: '2026-11-08T20:00:00.000Z' },
      { title: `Q's "plan"`, link: '', published: '' },
    ]);
  });
  it('parses Atom', () => {
    const xml = `<feed><entry><title type="html">Hello</title><link rel="alternate" href="https://v.com/1"/><updated>2026-11-08T10:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml)).toEqual([{ title: 'Hello', link: 'https://v.com/1', published: '2026-11-08T10:00:00.000Z' }]);
  });
  it('decodes numeric entities', () => expect(decode('caf&#233; &#x2014; ok')).toBe('café — ok'));
});

describe('markets', () => {
  it('reads Yahoo chart data', () => {
    expect(parseChart('AAPL', { chart: { result: [{ meta: { symbol: 'AAPL', shortName: 'Apple Inc.', regularMarketPrice: 342.37, regularMarketChangePercent: -0.523, currency: 'USD' } }] } })).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 342.37,
      changePct: -0.52,
      currency: 'USD',
    });
    expect(parseChart('BTC-USD', { chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100 } }] } }).changePct).toBe(10);
    expect(parseChart('X', { chart: { result: [] } })).toBeNull();
  });
});

describe('sports', () => {
  it('reads an ESPN team with its latest game', () => {
    const t = parseTeam('football/nfl/den', {
      team: {
        displayName: 'Denver Broncos',
        abbreviation: 'DEN',
        color: '0a2343',
        logos: [{ href: 'https://a.espncdn.com/den.png' }],
        record: { items: [{ summary: '7-2' }] },
        nextEvent: [
          {
            shortName: 'DEN @ CAR',
            date: '2026-11-08T18:00Z',
            competitions: [
              {
                status: { type: { state: 'post', shortDetail: 'Final' } },
                competitors: [
                  { homeAway: 'home', team: { abbreviation: 'CAR' }, score: { displayValue: '21' } },
                  { homeAway: 'away', team: { abbreviation: 'DEN' }, score: { displayValue: '26' }, winner: true },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(t).toMatchObject({ name: 'Denver Broncos', record: '7-2', color: '#0a2343', game: { state: 'post', detail: 'Final' } });
    expect(t.game.competitors.map((c) => `${c.abbr} ${c.score}`)).toEqual(['CAR 21', 'DEN 26']);
    expect(parseTeam('x', {})).toBeNull();
  });
});

describe('commute', () => {
  it('parses coordinates and rejects anything else', () => {
    expect(parseLatLon('40.52,-111.86')).toEqual({ lat: 40.52, lon: -111.86 });
    expect(parseLatLon(' 40.52 , -111.86 ')).toEqual({ lat: 40.52, lon: -111.86 });
    expect(parseLatLon('123 Main St')).toBeNull();
    expect(parseLatLon('95,10')).toBeNull();
  });
});

describe('widgets dispatcher', () => {
  it('finds the route from the rewrite or the path', () => {
    expect(routeOf('/api/widgets?route=news&sources=npr')).toBe('news');
    expect(routeOf('/api/feed?name=shopping')).toBe('feed');
    expect(routeOf('/api/markets?symbols=AAPL')).toBe('markets');
    expect(routeOf('/api/widgets?route=evil')).toBeNull();
    expect(routeOf('/api/widgets')).toBeNull();
  });
});

import { sniffImage } from '../api/camera.js';
import { cameraErrorText } from '../src/services/cameraErrors';

describe('camera', () => {
  it('recognises image bytes sent with a generic content type', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from('{"url":"https://x"}'))).toBe('');
  });
  it('explains failures in plain words', () => {
    expect(cameraErrorText('blinds cam', 'camera_not_found', 'Unknown camera')).toBe('n8n doesn’t know a camera called “blinds cam” (Unknown camera).'.replace('’', "'"));
    expect(cameraErrorText('x', 'not_configured')).toMatch(/JARVIS_MEDIA_URL/);
  });
});
