import { describe, it, expect } from 'vitest';
import { applyVixGate } from './market-regime.service.js';

describe('applyVixGate', () => {
  it('returns bear when VIX > 30 regardless of SPY regime', () => {
    expect(applyVixGate('bull', 35)).toBe('bear');
    expect(applyVixGate('neutral', 31)).toBe('bear');
  });

  it('returns neutral when VIX 20-30 and regime is bull', () => {
    expect(applyVixGate('bull', 25)).toBe('neutral');
  });

  it('returns original regime when VIX < 20', () => {
    expect(applyVixGate('bull', 15)).toBe('bull');
    expect(applyVixGate('neutral', 18)).toBe('neutral');
    expect(applyVixGate('bear', 10)).toBe('bear');
  });
});
