import { describe, it, expect } from 'vitest';
import { pearson, toReturns } from './correlation.js';

describe('pearson', () => {
  it('returns ~1 for identical series', () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 5);
  });
  it('returns ~-1 for inverted series', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });
  it('returns ~0 for orthogonal series', () => {
    expect(Math.abs(pearson([1, -1, 1, -1], [1, 1, -1, -1]))).toBeLessThan(1e-9);
  });
  it('returns NaN for a constant (zero-variance) series', () => {
    expect(Number.isNaN(pearson([1, -1, 1, -1], [1, 1, 1, 1]))).toBe(true);
  });
  it('returns NaN when fewer than 2 overlapping points', () => {
    expect(Number.isNaN(pearson([1], [1]))).toBe(true);
  });
  it('handles unequal lengths by truncating to the shorter (aligned at the end)', () => {
    expect(pearson([9, 1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
});

describe('toReturns', () => {
  it('converts close prices to simple returns', () => {
    const r = toReturns([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });
  it('returns [] for a single price', () => {
    expect(toReturns([100])).toEqual([]);
  });
});
