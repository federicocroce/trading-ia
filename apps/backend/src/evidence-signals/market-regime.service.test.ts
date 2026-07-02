import { describe, it, expect } from 'vitest';
import { applyVixGate, buildDegradedRegime } from './market-regime.service.js';

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

describe('buildDegradedRegime — fail-safe sin datos', () => {
  it('con régimen previo cacheado devuelve el previo marcado degraded (stale > ciego)', () => {
    const prev = { regime: 'bear' as const, spyPrice: 520, sma200: 540, priceVsSma200Pct: -3.7, checkedAt: '2026-07-01T12:00:00Z' };
    const res = buildDegradedRegime(prev);
    expect(res.regime).toBe('bear');
    expect(res.degraded).toBe(true);
  });

  it('sin régimen previo devuelve neutral degradado (NO operable como neutral real)', () => {
    const res = buildDegradedRegime(null);
    expect(res.regime).toBe('neutral');
    expect(res.degraded).toBe(true);
    expect(res.spyPrice).toBe(0);
  });

  it('es idempotente: un previo ya degradado (fallo repetido) queda degradado y conserva el régimen', () => {
    const prev = { regime: 'bear' as const, spyPrice: 520, sma200: 540, priceVsSma200Pct: -3.7, checkedAt: '2026-07-01T12:00:00Z', degraded: true };
    const res = buildDegradedRegime(prev);
    expect(res.regime).toBe('bear');
    expect(res.degraded).toBe(true);
    expect(res.spyPrice).toBe(520);
  });
});
