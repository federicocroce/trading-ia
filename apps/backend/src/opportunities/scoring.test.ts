import { describe, it, expect } from 'vitest';
import { scoreToAction, computeTradeLevels } from './scoring.js';
import type { TechnicalSummary } from '@trading/shared';

// Construye el TechnicalSummary mínimo que computeTradeLevels lee: currentPrice, atr14,
// supports/resistances. El resto de indicators no lo toca esta función — se completa con
// valores neutros para satisfacer el tipo.
function mkTech(overrides: {
  currentPrice: number;
  atr14: number | null;
  supports?: { price: number; touches: number; strength?: number }[];
  resistances?: { price: number; touches: number; strength?: number }[];
}): TechnicalSummary {
  return {
    symbol: 'TEST',
    signal: 'neutral',
    score: 0,
    timing: null,
    indicators: {
      rsi14: null,
      macd: null,
      sma20: null,
      sma50: null,
      sma200: null,
      bollingerBands: null,
      currentPrice: overrides.currentPrice,
      priceVsSma20: 0,
      priceVsSma50: 0,
      priceVsSma200: 0,
      volumeRatio: 1,
      stochastic: null,
      atr14: overrides.atr14,
      atrPercent: null,
      obvTrend: null,
      obvDivergence: false,
      supports: (overrides.supports ?? []).map(s => ({ price: s.price, touches: s.touches, strength: s.strength ?? 50 })),
      resistances: (overrides.resistances ?? []).map(r => ({ price: r.price, touches: r.touches, strength: r.strength ?? 50 })),
      nearestSupport: null,
      nearestResistance: null,
      crossovers: null,
      bbSqueeze: false,
      bbSqueezeIntensity: null,
    },
  };
}

// Caracterización del mapeo score → acción (núcleo del veredicto). Bloquea el comportamiento
// y verifica que sigue los ACTION_THRESHOLDS (config = fuente única).
describe('scoreToAction', () => {
  it('STRONG BUY: score≥72 + confidence≥70 + sin conflictos → BUY', () => {
    expect(scoreToAction(75, false, 70, false)).toBe('BUY');
  });

  it('score≥72 con conflictos → WATCH (no entra con tape contradictorio)', () => {
    expect(scoreToAction(75, false, 70, true)).toBe('WATCH');
  });

  it('score≥58 sin conflictos → BUY', () => {
    expect(scoreToAction(60, false, 0, false)).toBe('BUY');
  });

  it('score≥58 con conflictos → WATCH', () => {
    expect(scoreToAction(60, false, 0, true)).toBe('WATCH');
  });

  it('score 52-57 en portfolio → HOLD; fuera → WATCH', () => {
    expect(scoreToAction(55, true)).toBe('HOLD');
    expect(scoreToAction(55, false)).toBe('WATCH');
  });

  it('score 42-51 en portfolio → HOLD; fuera → WATCH', () => {
    expect(scoreToAction(45, true)).toBe('HOLD');
    expect(scoreToAction(45, false)).toBe('WATCH');
  });

  it('score <42 en portfolio → SELL; fuera → WATCH', () => {
    expect(scoreToAction(30, true)).toBe('SELL');
    expect(scoreToAction(30, false)).toBe('WATCH');
  });
});

// Reverse splits / colapsos tipo SDOT dejan "soportes" del clustering a -90% del entry.
// Sin clamp, el stop estructural es absurdo y el setup queda como si fuera operable.
describe('computeTradeLevels — clamp de riesgo (caso SDOT)', () => {
  it('stop estructural absurdo se clampea a 3x ATR', () => {
    // SDOT-like: precio 24.58, ATR 2.0, "soporte" del chart destruido en 0.77
    const tech = mkTech({ currentPrice: 24.58, atr14: 2.0, supports: [{ price: 0.77, touches: 3 }], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    // stop clampeado: nunca más lejos que 3x ATR del entry
    expect(levels.entryPrice - levels.stopLoss).toBeLessThanOrEqual(3 * 2.0 + 0.01);
    expect(levels.setupQuality).toBe('valid');
  });

  it('riesgo > MAX_SETUP_RISK_PCT marca setup invalid', () => {
    // Precio 10, ATR gigante 2.5 → stop ATR queda a -37.5% > 10% máximo
    const tech = mkTech({ currentPrice: 10, atr14: 2.5, supports: [], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('invalid');
    expect(levels.setupWarning).toContain('riesgo');
  });

  it('setup normal sigue valid sin cambios', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [{ price: 96, touches: 4 }], resistances: [{ price: 110, touches: 3 }] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('valid');
    expect(levels.stopLoss).toBeGreaterThan(90);
  });
});
