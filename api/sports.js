// Team records and the latest / next game for the HUD's sports widget (ESPN's public site API).
//
//   GET /api/sports?teams=football/nfl/den,basketball/nba/uta
//     -> { teams: [{ key, name, abbr, logo, color, record, game: { name, date, state, detail, competitors } }] }
import { createRateLimiter, guardRequest } from './_lib/requestGuard.js';
import { requireSession } from './_lib/session.js';

const limiter = createRateLimiter(30);
const CACHE_MS = 3 * 60 * 1000;
const cache = new Map();

/** Leagues the widget offers (sport/league as ESPN names them) */
export const LEAGUES = {
  'football/nfl': 'NFL',
  'basketball/nba': 'NBA',
  'baseball/mlb': 'MLB',
  'hockey/nhl': 'NHL',
  'soccer/usa.1': 'MLS',
  'basketball/wnba': 'WNBA',
  'football/college-football': 'College football',
  'basketball/mens-college-basketball': "Men's college basketball",
  'soccer/eng.1': 'Premier League',
};
const TEAM_RE = /^[a-z0-9-]{1,12}$/i;

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

const https = (v) => (typeof v === 'string' && v.startsWith('https://') ? v : '');
const color = (v) => (typeof v === 'string' && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : '');

/** ESPN team response → the widget's shape */
export function parseTeam(key, data) {
  const t = data?.team;
  if (!t?.displayName) return null;
  const ev = Array.isArray(t.nextEvent) ? t.nextEvent[0] : null;
  const comp = ev?.competitions?.[0];
  const status = comp?.status?.type || ev?.status?.type || {};
  const game = ev
    ? {
        name: String(ev.shortName || ev.name || '').slice(0, 80),
        date: typeof ev.date === 'string' ? ev.date : '',
        state: ['pre', 'in', 'post'].includes(status.state) ? status.state : 'pre',
        detail: String(status.shortDetail || status.detail || '').slice(0, 60),
        competitors: (comp?.competitors || []).slice(0, 2).map((c) => ({
          abbr: String(c.team?.abbreviation || '').slice(0, 6),
          score: c.score?.displayValue ?? (typeof c.score === 'string' ? c.score : ''),
          homeAway: c.homeAway === 'home' ? 'home' : 'away',
          logo: https(c.team?.logos?.[0]?.href),
          winner: Boolean(c.winner),
        })),
      }
    : null;
  return {
    key,
    name: String(t.displayName).slice(0, 60),
    abbr: String(t.abbreviation || '').slice(0, 6),
    logo: https(t.logos?.[0]?.href),
    color: color(t.color),
    record: String(t.record?.items?.[0]?.summary || '').slice(0, 20),
    standing: String(t.standingSummary || '').slice(0, 60),
    game,
  };
}

async function team(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.t;
  const [sport, league, abbr] = key.split('/');
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${encodeURIComponent(abbr)}`, {
    headers: { 'User-Agent': 'JarvisHUD/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = parseTeam(key, await res.json());
  if (!t) throw new Error('no team');
  cache.set(key, { at: Date.now(), t });
  return t;
}

/** ESPN league teams response → [{ abbr, name }] sorted by name */
export function parseLeagueTeams(data) {
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return teams
    .map((t) => ({ abbr: String(t.team?.abbreviation || '').toLowerCase(), name: String(t.team?.displayName || '').slice(0, 60) }))
    .filter((t) => TEAM_RE.test(t.abbr) && t.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function leagueTeams(league) {
  const key = `league:${league}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.t;
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league}/teams?limit=500`, {
    headers: { 'User-Agent': 'JarvisHUD/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = parseLeagueTeams(await res.json());
  cache.set(key, { at: Date.now(), t });
  return t;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!guardRequest(req, res, limiter)) return;
  if (!requireSession(req, res)) return;
  let params;
  try {
    params = new URL(req.url, 'http://x').searchParams;
  } catch {
    return sendJson(res, 400, { error: 'bad_request' });
  }
  // ?league=football/nfl -> the league's teams (for the widget's team picker)
  const league = params.get('league');
  if (league !== null) {
    if (!Object.prototype.hasOwnProperty.call(LEAGUES, league)) return sendJson(res, 400, { error: 'unknown_league' });
    try {
      return sendJson(res, 200, { teams: await leagueTeams(league) });
    } catch (err) {
      console.warn('[/api/sports] league failed:', err?.message || err);
      return sendJson(res, 502, { error: 'sports_error' });
    }
  }
  let keys = (params.get('teams') || '').split(',');
  // "<sport>/<league>/<team>" with a known league
  keys = [
    ...new Set(
      keys
        .map((k) => k.trim().toLowerCase())
        .filter((k) => {
          const i = k.lastIndexOf('/');
          return i > 0 && Object.prototype.hasOwnProperty.call(LEAGUES, k.slice(0, i)) && TEAM_RE.test(k.slice(i + 1));
        })
    ),
  ].slice(0, 8);
  if (!keys.length) return sendJson(res, 400, { error: 'no_teams' });
  const results = await Promise.allSettled(keys.map(team));
  sendJson(res, 200, {
    teams: results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    failed: keys.filter((_, i) => results[i].status === 'rejected'),
  });
}
