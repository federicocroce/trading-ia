import { describe, it, expect } from 'vitest';
import { detectBase } from './base-detector.js';
import type { OHLC } from '@trading/shared';

// Serie sintética: precios y volúmenes controlados por tramos.
// mk(300, i => 100, i => 1e6) = 300 barras planas a $100 con 1M de volumen.
function mk(n: number, price: (i: number) => number, vol: (i: number) => number = () => 1_000_000): OHLC[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${i}`, open: price(i), high: price(i) * 1.01, low: price(i) * 0.99,
    close: price(i), volume: vol(i),
  }));
}
const flatSpy = (n: number) => Array.from({ length: n }, () => 500);

// Base clásica: cayó de 100 a 55 (bajo SMA200), últimos 30d recupera a 62 (sobre SMA50
// y SMA50 subiendo), volumen 20d > 60d.
function baseCase(): OHLC[] {
  return mk(300,
    (i) => (i < 200 ? 100 - (i * 45) / 200 : i < 270 ? 55 : 55 + ((i - 270) * 7) / 30),
    (i) => (i >= 280 ? 2_000_000 : 1_000_000),
  );
}

describe('detectBase — fail-closed y criterios', () => {
  it('historial insuficiente (<220 barras) rechaza', () => {
    const r = detectBase(mk(100, () => 50), flatSpy(100));
    expect(r.isBase).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/historial insuficiente/i);
  });

  it('ilíquida rechaza (dollar volume 20d < piso)', () => {
    const bars = baseCase().map((b) => ({ ...b, volume: 100 })); // ~$6k/día
    const r = detectBase(bars, flatSpy(300));
    expect(r.isBase).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/liquidez/i);
  });

  it('base clásica detecta: castigada + reparando + volumen despertando', () => {
    const r = detectBase(baseCase(), flatSpy(300));
    expect(r.isBase).toBe(true);
    expect(r.strength).toBeGreaterThanOrEqual(1);
  });

  it('en tendencia alcista plena (sobre SMA200, cerca de máximos) NO es base', () => {
    const r = detectBase(mk(300, (i) => 100 + i * 0.5), flatSpy(300));
    expect(r.isBase).toBe(false);
  });

  it('castigada pero todavía cayendo (bajo SMA50) NO es base — cuchillo', () => {
    const r = detectBase(mk(300, (i) => 100 - i * 0.2), flatSpy(300));
    expect(r.isBase).toBe(false);
  });

  it('castigada y sobre SMA50 pero sin volumen NI RS (SPY sube más) NO alcanza', () => {
    // Precio repara suave con volumen plano; SPY sube 10% el último mes → RS negativo.
    const bars = mk(300, (i) => (i < 200 ? 100 - (i * 45) / 200 : i < 270 ? 55 : 55 + ((i - 270) * 3) / 30));
    const spy = Array.from({ length: 300 }, (_, i) => (i < 279 ? 500 : 500 + (i - 279) * 2.5));
    const r = detectBase(bars, spy);
    expect(r.isBase).toBe(false);
  });
});
