import { describe, expect, it } from 'vitest';
import { httpsUrl, rankStations, searchStations, tagOf, toStations } from './radio';

const raw = (o: Record<string, unknown>) => ({ stationuuid: 'id', name: 'X', url_resolved: 'https://a.example/s', codec: 'MP3', bitrate: 128, votes: 1, lastcheckok: 1, tags: 'lofi,chill', country: 'Germany', ...o });

describe('radio', () => {
  it('upgrades http streams to https (and drops the port-80 trap)', () => {
    expect(httpsUrl('http://streams.example.de/chill/mp3-320')).toBe('https://streams.example.de/chill/mp3-320');
    expect(httpsUrl('http://host.example:80/live')).toBe('https://host.example/live');
    expect(httpsUrl('https://ok.example/s')).toBe('https://ok.example/s');
    expect(httpsUrl('ftp://nope')).toBe('');
    expect(httpsUrl('not a url')).toBe('');
  });

  it('keeps playable, working, unique stations', () => {
    const list = toStations([
      raw({ name: 'Good', url_resolved: 'https://good.example/s' }),
      raw({ name: 'Broken', url_resolved: 'https://b.example/s', lastcheckok: 0 }),
      raw({ name: 'HLS', url_resolved: 'https://h.example/live.m3u8', codec: 'AAC' }),
      raw({ name: 'Weird codec', codec: 'WMA', url_resolved: 'https://w.example/s' }),
      raw({ name: 'Good dup', url_resolved: 'https://good.example/s' }),
      raw({ name: 'GOOD!', url_resolved: 'https://other.example/s' }),
      raw({ name: 'Plain http', url_resolved: 'http://p.example/s' }),
    ]);
    expect(list.map((s) => s.name)).toEqual(['Good', 'Plain http']);
    expect(list[1]).toMatchObject({ url: 'https://p.example/s', nativeHttps: false });
  });

  it('ranks stations that offer https first, then by votes', () => {
    const list = toStations([
      raw({ name: 'Popular http', url_resolved: 'http://a.example/s', votes: 5000 }),
      raw({ name: 'Small https', url_resolved: 'https://b.example/s', votes: 10 }),
      raw({ name: 'Big https', url_resolved: 'https://c.example/s', votes: 900 }),
    ]);
    expect(rankStations(list).map((s) => s.name)).toEqual(['Big https', 'Small https', 'Popular http']);
  });

  it('searches by name and by genre tag, name matches first', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      const body = url.includes('name=') ? [raw({ name: 'KSL NewsRadio', url_resolved: 'https://ksl.example/s' })] : [raw({ name: 'Some lofi', url_resolved: 'https://lofi.example/s', votes: 999 })];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const found = await searchStations('Lo-Fi', 12, fakeFetch);
    expect(found.map((s) => s.name)).toEqual(['KSL NewsRadio', 'Some lofi']);
    expect(urls.some((u) => u.includes('tag=lofi'))).toBe(true);
    expect(tagOf('Lo-Fi Hip_Hop')).toBe('lofi hiphop');
  });

  it('falls back to the next directory server', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls <= 2) throw new Error('down');
      return new Response(JSON.stringify([raw({ name: 'Jazz FM', url_resolved: 'https://jazz.example/s' })]), { status: 200 });
    }) as typeof fetch;
    const found = await searchStations('jazz', 12, flaky);
    expect(found[0]?.name).toBe('Jazz FM');
  });
});
