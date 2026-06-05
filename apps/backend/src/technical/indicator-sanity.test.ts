import { describe, it, expect } from 'vitest';
import { sanitizeSMA, sanitizeMovingAverages } from './indicator-sanity.js';

describe('sanitizeSMA', () => {
  it('nulls an SMA wildly above price (split poison)', () => {
    expect(sanitizeSMA(217, 9, 4)).toBeNull();   // VCIG-style
    expect(sanitizeSMA(573, 0.48, 4)).toBeNull(); // HUBC-style
  });
  it('nulls an SMA wildly below price', () => {
    expect(sanitizeSMA(2, 100, 4)).toBeNull();
  });
  it('keeps an in-range SMA', () => {
    expect(sanitizeSMA(42, 38, 4)).toBe(42);
    expect(sanitizeSMA(150, 100, 4)).toBe(150);   // exactly within 4x boundary stays
  });
  it('passes through null/0 inputs untouched', () => {
    expect(sanitizeSMA(null, 10, 4)).toBeNull();
    expect(sanitizeSMA(50, 0, 4)).toBe(50); // no price reference → cannot judge, keep
  });
});

describe('sanitizeMovingAverages', () => {
  it('nulls only the out-of-range SMAs and flags them', () => {
    const r = sanitizeMovingAverages({ sma20: 9.2, sma50: 9.5, sma200: 217 }, 9, 4);
    expect(r.sma20).toBe(9.2);
    expect(r.sma50).toBe(9.5);
    expect(r.sma200).toBeNull();
    expect(r.flags).toContain('sma200');
  });
  it('no flags when all in range', () => {
    const r = sanitizeMovingAverages({ sma20: 10, sma50: 11, sma200: 12 }, 10, 4);
    expect(r.flags).toEqual([]);
  });
});
