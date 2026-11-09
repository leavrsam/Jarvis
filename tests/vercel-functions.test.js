// Vercel's Hobby plan deploys at most 12 Serverless Functions; a 13th fails the whole deploy
// ("No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan").
// Every file under api/ is one function, except files and folders starting with "_".
// Add new routes to an existing function (see api/widgets.js + the rewrites in vercel.json).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOBBY_LIMIT = 12;

function functions(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...functions(join(dir, e.name), `${prefix}${e.name}/`));
    else if (/\.(js|mjs|cjs|ts|mts)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(prefix + e.name);
  }
  return out;
}

describe('Vercel deploy limits', () => {
  it(`has at most ${HOBBY_LIMIT} serverless functions in api/`, () => {
    const fns = functions(join(process.cwd(), 'api'));
    expect(fns.length, `api/ has ${fns.length} functions: ${fns.join(', ')}`).toBeLessThanOrEqual(HOBBY_LIMIT);
  });
});
