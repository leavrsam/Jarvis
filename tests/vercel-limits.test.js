import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vercel's Hobby plan deploys at most 12 serverless functions; every .js file directly in api/
// is one. Over the limit the deployment fails outright (it did once: 15 functions). Put new
// routes behind an existing function (see api/widgets.js) instead.
describe('Vercel function limit', () => {
  it('has at most 12 functions in api/', () => {
    const dir = fileURLToPath(new URL('../api/', import.meta.url));
    const functions = readdirSync(dir).filter((f) => /\.(js|ts|mjs|cjs)$/.test(f) && !f.startsWith('_'));
    expect(functions.length, functions.join(', ')).toBeLessThanOrEqual(12);
  });
});
