import { describe, it, expect } from 'vitest';
import { computeConfluencePercent } from './confluence.js';

describe('computeConfluencePercent', () => {
  it('caps thin single-axis 2-of-2 agreement well below 95 (EVEN bug)', () => {
    expect(computeConfluencePercent(2, 2, 1)).toBeLessThanOrEqual(60);
  });
  it('keeps 2-axis thin data moderate', () => {
    expect(computeConfluencePercent(2, 2, 2)).toBeLessThanOrEqual(75);
    expect(computeConfluencePercent(2, 2, 2)).toBeGreaterThan(40);
  });
  it('rewards full multi-axis confluence (>=85)', () => {
    expect(computeConfluencePercent(8, 8, 3)).toBeGreaterThanOrEqual(85);
  });
  it('drops on a split vote', () => {
    expect(computeConfluencePercent(4, 8, 3)).toBeLessThan(60);
  });
  it('returns 30 with no votes', () => {
    expect(computeConfluencePercent(0, 0, 0)).toBe(30);
  });
  it('never exceeds the axis cap', () => {
    expect(computeConfluencePercent(10, 10, 1)).toBeLessThanOrEqual(55);
    expect(computeConfluencePercent(10, 10, 2)).toBeLessThanOrEqual(75);
    expect(computeConfluencePercent(10, 10, 3)).toBeLessThanOrEqual(95);
  });
});
