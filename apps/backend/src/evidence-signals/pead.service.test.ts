import { describe, it, expect } from 'vitest';
import { validatePriceDirection } from './pead.service.js';

describe('validatePriceDirection — fail-closed sin datos', () => {
  it('sin histórico OHLC NO confirma la señal (antes confirmaba por defecto)', () => {
    const res = validatePriceDirection('2026-06-15', []);
    expect(res.confirmed).toBe(false);
    expect(res.changePct).toBeNull();
  });

  it('sin velas pre-earnings NO confirma', () => {
    const res = validatePriceDirection('2026-06-15', [
      { date: '2026-06-16', open: 10, high: 11, low: 9.5, close: 10.5, volume: 1000 },
    ]);
    expect(res.confirmed).toBe(false);
  });

  it('subida real post-earnings confirma', () => {
    const res = validatePriceDirection('2026-06-15', [
      { date: '2026-06-13', open: 10, high: 10.2, low: 9.8, close: 10, volume: 1000 },
      { date: '2026-06-16', open: 10.5, high: 11.5, low: 10.4, close: 11.2, volume: 2000 },
    ]);
    expect(res.confirmed).toBe(true);
    expect(res.changePct).toBeGreaterThan(0);
  });
});
