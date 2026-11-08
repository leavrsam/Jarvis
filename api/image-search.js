// Image search for the HUD screen (SHOW_IMAGE_SEARCH: <what to show>).
//
// Jarvis's language model can't be trusted to know real image URLs (it invents plausible-looking
// ones that 404), so he names what to show and this finds a real, openly licensed photo:
// Openverse first (Flickr, museums, etc.), then Wikimedia Commons. No API keys needed.
// Returns { url, title, creator, license, source, pageUrl } for the first result that loads.
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(20);
const USER_AGENT = 'JarvisHUD/1.0 (personal home assistant image search)';
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map(); // query -> { at, result }

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function queryParam(req) {
  if (req.query && typeof req.query.q === 'string') return req.query.q;
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('q') || '';
  } catch {
    return '';
  }
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

async function getJson(url, timeoutMs = 6000) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Does the image actually load? (Search indexes keep dead links) */
async function imageLoads(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(2500) });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    return res.ok && type.startsWith('image/') && !type.includes('svg');
  } catch {
    return false;
  }
}

async function searchOpenverse(q) {
  const params = new URLSearchParams({ q, page_size: '12', mature: 'false', category: 'photograph', size: 'large' });
  let data = await getJson(`https://api.openverse.org/v1/images/?${params}`);
  if (!data?.results?.length) {
    // Retry without the photo/size filters (fewer, but some topics only have illustrations)
    data = await getJson(`https://api.openverse.org/v1/images/?${new URLSearchParams({ q, page_size: '12', mature: 'false' })}`);
  }
  return (data?.results || [])
    .filter((r) => isHttps(r.url) && !/\.svg($|\?)/i.test(r.url) && (!r.width || r.width >= 500))
    .map((r) => ({
      url: r.url,
      title: r.title || q,
      creator: r.creator || '',
      license: r.license ? `CC ${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`.replace('CC CC0', 'CC0').replace('CC PDM', 'Public domain') : '',
      source: `Openverse${r.source ? ` · ${r.source}` : ''}`,
      pageUrl: isHttps(r.foreign_landing_url) ? r.foreign_landing_url : '',
    }));
}

async function searchWikimedia(q) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1600',
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const strip = (html) => String(html || '').replace(/<[^>]*>/g, '').trim();
  return pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info || !/^image\/(jpeg|png|webp|gif)$/.test(info.mime || '')) return null;
      const url = info.thumburl || info.url;
      if (!isHttps(url)) return null;
      const meta = info.extmetadata || {};
      return {
        url,
        title: strip(meta.ObjectName?.value) || String(p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        creator: strip(meta.Artist?.value).slice(0, 80),
        license: strip(meta.LicenseShortName?.value),
        source: 'Wikimedia Commons',
        pageUrl: isHttps(info.descriptionurl) ? info.descriptionurl : '',
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;

  const q = queryParam(req).trim().replace(/\s+/g, ' ');
  if (!q || q.length > 100) {
    sendJson(res, 400, { error: 'bad_query' });
    return;
  }
  // ?count=N (2-12): several photos for a slideshow (the photo frame widget). The page skips
  // any that fail to load, so they aren't checked one by one here.
  let count = 1;
  try {
    count = Math.max(1, Math.min(12, Number(new URL(req.url, 'http://localhost').searchParams.get('count')) || 1));
  } catch {}
  if (count > 1) {
    const listKey = `list:${count}:${q.toLowerCase()}`;
    const listHit = cache.get(listKey);
    if (listHit && Date.now() - listHit.at < CACHE_MS) return sendJson(res, 200, listHit.result);
    let results = [];
    for (const [name, search] of [
      ['openverse', searchOpenverse],
      ['wikimedia', searchWikimedia],
    ]) {
      try {
        results = results.concat(await search(q));
      } catch (err) {
        console.warn(`[/api/image-search] ${name} failed:`, err?.message || err);
      }
      if (results.length >= count) break;
    }
    if (!results.length) return sendJson(res, 404, { error: 'no_image' });
    const result = { results: results.slice(0, count) };
    cache.set(listKey, { at: Date.now(), result });
    return sendJson(res, 200, result);
  }

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    sendJson(res, 200, hit.result);
    return;
  }

  for (const [name, search] of [
    ['openverse', searchOpenverse],
    ['wikimedia', searchWikimedia],
  ]) {
    let candidates = [];
    try {
      candidates = await search(q);
    } catch (err) {
      console.warn(`[/api/image-search] ${name} failed:`, err?.message || err);
      continue;
    }
    // First of the top few that actually loads
    for (const c of candidates.slice(0, 4)) {
      if (await imageLoads(c.url)) {
        cache.set(key, { at: Date.now(), result: c });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        sendJson(res, 200, c);
        return;
      }
    }
  }
  sendJson(res, 404, { error: 'no_image' });
}
