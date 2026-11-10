// Free internet radio for PLAY_RADIO: <what>. Stations come from Radio Browser
// (https://www.radio-browser.info), a free, open, community directory of ~50,000 stations with
// no API key. The browser asks it directly (it allows cross-origin requests).
//
// Jarvis's site is https, so plain http:// streams are blocked by the browser. Stations that
// offer https come first; for the rest an https:// version of the same address is tried, which
// many stream servers support. The player moves on to the next station if one won't start.

export interface Station {
  id: string;
  name: string;
  /** https address to play */
  url: string;
  /** The station listed an https stream itself (more likely to work than an upgraded one) */
  nativeHttps: boolean;
  homepage: string;
  favicon: string;
  country: string;
  tags: string;
  codec: string;
  bitrate: number;
  votes: number;
}

const API_HOSTS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://all.api.radio-browser.info'];

/** Formats browsers play from a plain audio element (HLS / m3u8 isn't one of them in Chrome desktop) */
const PLAYABLE = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS', 'FLAC', '']);

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** An https version of a stream address, or '' if there's no sensible one */
export function httpsUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === 'https:') return u.href;
    if (u.protocol !== 'http:') return '';
    u.protocol = 'https:';
    // "https://host:80" can't work (port 80 is plain http)
    if (u.port === '80') u.port = '';
    return u.href;
  } catch {
    return '';
  }
}

/** Radio Browser's JSON → playable stations (deduplicated, broken ones dropped) */
export function toStations(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const s = r as Record<string, unknown>;
    if (s.lastcheckok === 0 || s.lastcheckok === '0') continue;
    const original = str(s.url_resolved, 500) || str(s.url, 500);
    const url = httpsUrl(original);
    const codec = str(s.codec, 20).toUpperCase();
    const name = str(s.name, 120);
    if (!url || !name || !PLAYABLE.has(codec) || /\.m3u8(\?|$)/i.test(url)) continue;
    // The directory often lists one station several times ("REYFM -#LOFI", "REYFM - #lofi")
    const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (seen.has(key) || seen.has(url)) continue;
    seen.add(key);
    seen.add(url);
    out.push({
      id: str(s.stationuuid, 64),
      name,
      url,
      nativeHttps: /^https:/i.test(original),
      homepage: httpsUrl(str(s.homepage, 300)),
      favicon: httpsUrl(str(s.favicon, 300)),
      country: str(s.country, 60),
      tags: str(s.tags, 120),
      codec,
      bitrate: Number(s.bitrate) || 0,
      votes: Number(s.votes) || 0,
    });
  }
  return out;
}

/** Best first: stations that offer https themselves, then by popularity */
export function rankStations(stations: Station[]): Station[] {
  return [...stations].sort((a, b) => {
    if (a.nativeHttps !== b.nativeHttps) return a.nativeHttps ? -1 : 1;
    return b.votes - a.votes || b.bitrate - a.bitrate;
  });
}

/** Tag form of a request ("Lo-Fi hip hop" → "lofi hip hop") */
export function tagOf(query: string): string {
  return query.toLowerCase().replace(/[-_]/g, '').replace(/\s+/g, ' ').trim();
}

async function getJson(path: string, fetchImpl: typeof fetch): Promise<unknown> {
  let lastError: unknown = null;
  for (const host of API_HOSTS) {
    try {
      const res = await fetchImpl(`${host}${path}`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('radio directory unreachable');
}

/**
 * Stations for a request: by name ("BBC Radio 1", "KSL") and by genre tag ("lofi", "jazz"),
 * merged and ranked. Up to `limit`.
 */
export async function searchStations(query: string, limit = 12, fetchImpl: typeof fetch = fetch): Promise<Station[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const common = 'hidebroken=true&order=votes&reverse=true&limit=40';
  const [byName, byTag] = await Promise.allSettled([
    getJson(`/json/stations/search?name=${encodeURIComponent(q)}&${common}`, fetchImpl),
    getJson(`/json/stations/search?tag=${encodeURIComponent(tagOf(q))}&${common}`, fetchImpl),
  ]);
  const names = byName.status === 'fulfilled' ? toStations(byName.value) : [];
  const tags = byTag.status === 'fulfilled' ? toStations(byTag.value) : [];
  if (byName.status === 'rejected' && byTag.status === 'rejected') throw byName.reason;
  // A name match ("KSL") beats a genre match; within each, best first
  const merged = [...rankStations(names), ...rankStations(tags)];
  const seen = new Set<string>();
  return merged.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).slice(0, limit);
}

/** Radio Browser asks players to report a play (it helps rank stations); best effort */
export function reportStationPlay(id: string, fetchImpl: typeof fetch = fetch) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  void fetchImpl(`${API_HOSTS[0]}/json/url/${id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}
