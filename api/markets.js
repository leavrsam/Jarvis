// Prices for the HUD's markets widget: stocks, indexes and crypto (Yahoo Finance chart data,
// no key). Symbols like AAPL, ^GSPC (S&P 500), ^IXIC (Nasdaq), BTC-USD, ETH-USD.
//
//   GET /api/markets?symbols=AAPL,^GSPC,BTC-USD -> { quotes: [{ symbol, name, price, changePct, currency, marketState }] }
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(30);
const CACHE_MS = 2 * 60 * 1000;
const SYMBOL_RE = /^[\^A-Za-z0-9.=-]{1,15}$/;
const cache = new Map();

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** Yahoo chart response → quote (null if it has no price) */
export function parseChart(symbol, data) {
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price)) return null;
  const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
  const changePct = Number.isFinite(Number(meta.regularMarketChangePercent))
    ? Number(meta.regularMarketChangePercent)
    : Number.isFinite(prev) && prev
      ? ((price - prev) / prev) * 100
      : 0;
  return {
    symbol: String(meta.symbol || symbol).slice(0, 15),
    name: String(meta.shortName || meta.longName || symbol).replace(/\s+/g, ' ').slice(0, 40),
    price,
    changePct: Math.round(changePct * 100) / 100,
    currency: String(meta.currency || '').slice(0, 5),
  };
}

async function quote(symbol) {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.q;
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=1d&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (JarvisHUD/1.0)', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const q = parseChart(key, await res.json());
  if (!q) throw new Error('no price');
  cache.set(key, { at: Date.now(), q });
  return q;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;
  let symbols = [];
  try {
    symbols = (new URL(req.url, 'http://x').searchParams.get('symbols') || '').split(',');
  } catch {}
  symbols = [...new Set(symbols.map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].slice(0, 12);
  if (!symbols.length) return sendJson(res, 400, { error: 'no_symbols' });
  const results = await Promise.allSettled(symbols.map(quote));
  sendJson(res, 200, {
    quotes: results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    failed: symbols.filter((_, i) => results[i].status === 'rejected'),
  });
}
