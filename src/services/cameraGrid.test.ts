import { describe, expect, it } from 'vitest';
import { bestColumns } from './cameraGrid';

describe('bestColumns', () => {
  it('stacks two wide feeds in the TV screen panel', () => {
    expect(bestColumns(2, 1050, 760)).toBe(1);
  });
  it('puts two wide feeds side by side in a very wide, short space', () => {
    expect(bestColumns(2, 1900, 400)).toBe(2);
  });
  it('uses a 2x2 grid for four feeds and more columns for many', () => {
    expect(bestColumns(4, 1050, 760)).toBe(2);
    expect(bestColumns(8, 1050, 760)).toBeGreaterThanOrEqual(2);
  });
  it('handles one feed and empty sizes', () => {
    expect(bestColumns(1, 1000, 700)).toBe(1);
    expect(bestColumns(3, 0, 0)).toBe(1);
  });
});
