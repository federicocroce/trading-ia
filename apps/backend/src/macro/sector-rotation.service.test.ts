import { describe, it, expect } from 'vitest';
import { computeReturn, classifySector } from './sector-rotation.service.js';

describe('computeReturn', () => {
  it('returns correct percent return for 21 days', () => {
    const closes = Array(30).fill(100).map((v, i) => v + i); // 100..129
    // closes[8] = 108 (21 days ago), closes[29] = 129 (last)
    const result = computeReturn(closes, 21);
    // (129 - 108) / 108 * 100 = 19.44%
    expect(result).toBeCloseTo(19.44, 1);
  });

  it('returns 0 when not enough data', () => {
    expect(computeReturn([100, 110], 21)).toBe(0);
  });
});

describe('classifySector', () => {
  it('returns LEADING when rs1m > 2 and rs3m > 3', () => {
    expect(classifySector(3, 4)).toBe('LEADING');
  });

  it('returns LAGGING when rs1m < -2', () => {
    expect(classifySector(-3, 0)).toBe('LAGGING');
  });

  it('returns LAGGING when rs3m < -3', () => {
    expect(classifySector(0, -4)).toBe('LAGGING');
  });

  it('returns NEUTRAL in the middle', () => {
    expect(classifySector(1, 2)).toBe('NEUTRAL');
  });
});
