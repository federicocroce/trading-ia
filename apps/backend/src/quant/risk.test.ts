import { describe, it, expect } from 'vitest';
import { classifyRegime, suggestPositionSize } from './risk.js';

describe('classifyRegime (filtro de régimen = el reductor de drawdown robusto)', () => {
  it('precio del índice sobre su SMA200 → risk_on', () => {
    expect(classifyRegime(450, 400)).toBe('risk_on');
  });
  it('precio bajo su SMA200 → risk_off', () => {
    expect(classifyRegime(380, 400)).toBe('risk_off');
  });
  it('sin datos → unknown', () => {
    expect(classifyRegime(null, 400)).toBe('unknown');
    expect(classifyRegime(450, null)).toBe('unknown');
  });
});

describe('suggestPositionSize (sizing por riesgo: cada trade arriesga lo mismo)', () => {
  it('dimensiona para arriesgar riskPct del portfolio según la distancia al stop', () => {
    // 100k, entry 100, stop 90 (riesgo $10/acción), riskPct 1% → arriesgar $1000 → 100 acciones
    const r = suggestPositionSize({ portfolioValue: 100_000, entry: 100, stop: 90, riskPct: 0.01 });
    expect(r!.shares).toBe(100);
    expect(r!.dollars).toBe(10_000);
    expect(r!.riskPct).toBeCloseTo(0.01, 3);
  });

  it('respeta el cap de concentración cuando el stop está muy cerca', () => {
    // stop a $1 → sin cap daría 1000 acciones ($100k = 100%). Cap 20% → 200 acciones.
    const r = suggestPositionSize({ portfolioValue: 100_000, entry: 100, stop: 99, riskPct: 0.01, maxPositionPct: 0.2 });
    expect(r!.dollars).toBe(20_000);
    expect(r!.shares).toBe(200);
  });

  it('devuelve null si no hay stop válido por debajo de la entrada', () => {
    expect(suggestPositionSize({ portfolioValue: 100_000, entry: 100, stop: 100, riskPct: 0.01 })).toBeNull();
    expect(suggestPositionSize({ portfolioValue: 100_000, entry: 100, stop: 110, riskPct: 0.01 })).toBeNull();
  });
});
