// Headlines for the HUD, from a fixed list of news feeds (RSS/Atom), fetched on the server
// (browsers can't read most feeds directly). Only listed sources can be fetched, so this
// can't be pointed at arbitrary addresses.
//
//   GET /api/news?sources=npr,bbc  ->  { items: [{ title, link, source, published }] }
import { createRateLimiter, guardRequest } from '../requestGuard.js';
import { requireSession } from '../session.js';

const limiter = createRateLimiter(30);
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export const NEWS_SOURCES = {
  npr: { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  bbc: { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  bbcWorld: { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  bbcTech: { name: 'BBC Tech', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  nyt: { name: 'NY Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  guardian: { name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
  ars: { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  verge: { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  hn: { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  espn: { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
  ksl: { name: 'KSL', url: 'https://www.ksl.com/rss/news' },
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (block, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
};

/** RSS <item> or Atom <entry> → { title, link, published } (https links only) */
export function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    let link = tag(b, 'link');
    if (!link) link = (/<link[^>]*href="([^"]+)"/i.exec(b) || [])[1] || '';
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const d = when ? new Date(when) : null;
    if (!title) continue;
    out.push({
      title: title.slice(0, 200),
      link: /^https:\/\//i.test(link.trim()) ? link.trim() : '',
      published: d && !Number.isNaN(d.getTime()) ? d.toISOString() : '',
    });
  }
  return out;
}

async function loadSource(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const src = NEWS_SOURCES[key];
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'JarvisHUD/1.0 (personal home assistant)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed((await res.text()).slice(0, 2_000_000)).slice(0, 20).map((i) => ({ ...i, source: src.name }));
  cache.set(key, { at: Date.now(), items });
  return items;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;
  let keys = [];
  try {
    keys = (new URL(req.url, 'http://x').searchParams.get('sources') || 'npr,bbc').split(',');
  } catch {}
  keys = [...new Set(keys.map((k) => k.trim()).filter((k) => Object.prototype.hasOwnProperty.call(NEWS_SOURCES, k)))].slice(0, 6);
  if (!keys.length) return sendJson(res, 400, { error: 'no_sources' });
  const results = await Promise.allSettled(keys.map(loadSource));
  const items = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
    .slice(0, 40);
  const failed = keys.filter((_, i) => results[i].status === 'rejected').map((k) => NEWS_SOURCES[k].name);
  sendJson(res, 200, { items, failed });
}
