import { describe, it, expect } from 'vitest';
import { factorsForSymbol } from './risk-factor-map.js';

describe('factorsForSymbol', () => {
  it('returns curated factors for known symbols', () => {
    expect(factorsForSymbol('YPF', undefined).sort()).toEqual(['argentina', 'emerging-markets', 'oil']);
    expect(factorsForSymbol('GLD', undefined).sort()).toEqual(['gold', 'safe-haven']);
    expect(factorsForSymbol('EOG', undefined).sort()).toEqual(['oil', 'us-equity']);
  });
  it('is case-insensitive', () => {
    expect(factorsForSymbol('ypf', undefined)).toContain('oil');
  });
  it('infers from sector when symbol is unknown', () => {
    expect(factorsForSymbol('UNKNOWN1', 'us-energy')).toContain('oil');
    expect(factorsForSymbol('UNKNOWN2', 'bonds')).toContain('rates');
  });
  it('returns [] for unknown symbol and unknown sector', () => {
    expect(factorsForSymbol('ZZZZ', 'made-up-sector')).toEqual([]);
  });
});
