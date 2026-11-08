// One serverless function for the HUD's widget data routes, so the deployment stays under
// Vercel's function limit (12 on the Hobby plan). vercel.json rewrites the public URLs here:
//   /api/feed     -> n8n-backed widget feeds (shopping, tasks, home, deliveries, doorbell, photos)
//   /api/news     -> headlines
//   /api/markets  -> stocks / indexes / crypto
//   /api/sports   -> team records and games
//   /api/commute  -> drive time
// The handlers live in api/_lib/widgets/ (folders starting with "_" aren't deployed as functions).
import feed from './_lib/widgets/feed.js';
import news from './_lib/widgets/news.js';
import markets from './_lib/widgets/markets.js';
import sports from './_lib/widgets/sports.js';
import commute from './_lib/widgets/commute.js';

const ROUTES = { feed, news, markets, sports, commute };

/** Which widget route a request is for: ?route= (from the rewrite), else the path's last part */
export function routeOf(url) {
  try {
    const u = new URL(url || '/', 'http://x');
    const fromQuery = u.searchParams.get('route');
    if (fromQuery && Object.prototype.hasOwnProperty.call(ROUTES, fromQuery)) return fromQuery;
    const last = u.pathname.replace(/\/+$/, '').split('/').pop();
    return Object.prototype.hasOwnProperty.call(ROUTES, last) ? last : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const route = routeOf(req.url);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  return ROUTES[route](req, res);
}
