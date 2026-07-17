import { describe, it, expect } from 'vitest';
import { scoreToAction, computeTradeLevels, computeConfluenceDetail } from './scoring.js';
import type { TechnicalSummary, FundamentalSummary } from '@trading/shared';

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
  it('stop estructural absurdo se clampea a 3x ATR Y el setup queda invalid (vol extrema)', () => {
    // SDOT-like: precio 24.58, ATR 2.0 (8% del precio), "soporte" del chart destruido en 0.77
    const tech = mkTech({ currentPrice: 24.58, atr14: 2.0, supports: [{ price: 0.77, touches: 3 }], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    // stop clampeado: nunca más lejos que 3x ATR del entry
    expect(levels.entryPrice - levels.stopLoss).toBeLessThanOrEqual(3 * 2.0 + 0.01);
    expect(levels.setupQuality).toBe('invalid'); // riesgo ~24% > 10%: no operable aunque el stop esté clampeado
  });

  it('clamp con volatilidad normal queda valid (el clamp salva el setup)', () => {
    // ATR 2% del precio; soporte absurdo en 50 → clamp a 3xATR = riesgo 6% → operable
    const tech = mkTech({ currentPrice: 100, atr14: 2.0, supports: [{ price: 50, touches: 2 }], resistances: [{ price: 112, touches: 3 }] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.entryPrice - levels.stopLoss).toBeLessThanOrEqual(6.01);
    expect(levels.setupQuality).toBe('valid');
  });

  it('riesgo > MAX_SETUP_RISK_PCT marca setup invalid', () => {
    // Precio 10, ATR gigante 2.5 → stop ATR queda a -37.5% > 10% máximo
    const tech = mkTech({ currentPrice: 10, atr14: 2.5, supports: [], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('invalid');
    expect(levels.setupWarning).toContain('riesgo');
  });

  it('setup invalid no sugiere sizing', () => {
    const tech = mkTech({ currentPrice: 10, atr14: 2.5, supports: [], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY', 100_000)!;
    expect(levels.setupQuality).toBe('invalid');
    expect(levels.suggestedQuantity).toBeUndefined();
  });

  it('setup normal sigue valid sin cambios', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [{ price: 96, touches: 4 }], resistances: [{ price: 110, touches: 3 }] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('valid');
    expect(levels.stopLoss).toBeGreaterThan(90);
  });
});

// R/R honesto: el target lejano (el que da buen R/R por diseño) puede estar bastante más
// arriba que la primera resistencia real — esta última es la que probablemente "cobra" el
// precio primero. Mostrar solo el R/R al target lejano es, en la práctica, sobre-vender el setup.
describe('computeTradeLevels — rrToFirstResistance (R/R honesto contra la 1ra resistencia)', () => {
  it('con una resistencia cercana que no alcanza el R/R mínimo, el target usa ATR y queda más lejos: rrToFirstResistance < riskRewardRatio', () => {
    // price=100, atr=2 → stop=97 (risk=3). Resistencia en 104 no alcanza minRequired (105) →
    // target se ajusta a 105 (ATR-based), más lejos que la resistencia real en 104.
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [], resistances: [{ price: 104, touches: 2 }] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.rrToFirstResistance).not.toBeNull();
    expect(levels.rrToFirstResistance!).toBeLessThan(levels.riskRewardRatio);
    // (104 - 100) / 3 = 1.33
    expect(levels.rrToFirstResistance).toBeCloseTo(1.33, 2);
  });

  it('sin resistencia por encima del entry, rrToFirstResistance es null', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.rrToFirstResistance).toBeNull();
  });

  it('WATCH también calcula rrToFirstResistance (misma rama que BUY)', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [], resistances: [{ price: 104, touches: 2 }] });
    const levels = computeTradeLevels(tech, 'WATCH')!;
    expect(levels.rrToFirstResistance).toBeCloseTo(1.33, 2);
  });

  it('SELL no calcula rrToFirstResistance (concepto es solo para setups de compra)', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [{ price: 90, touches: 2 }], resistances: [{ price: 103, touches: 2 }] });
    const levels = computeTradeLevels(tech, 'SELL')!;
    expect(levels.rrToFirstResistance).toBeNull();
  });
});

// FundamentalSummary mínimo para testear votos fundamentales de confluencia.
// Todo null por default (fail-closed): cada test setea solo lo que su voto necesita.
function mkFund(overrides: Partial<FundamentalSummary['data']>): FundamentalSummary {
  return {
    symbol: 'TEST',
    signal: 'fair',
    score: 50,
    data: {
      symbol: 'TEST',
      marketCap: null, peRatio: null, forwardPE: null, pegRatio: null,
      eps: null, dividendYield: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
      currentPrice: 100, priceVs52wHigh: null, priceVs52wLow: null,
      avgVolume: null, beta: null, revenueGrowth: null, grossMargin: null,
      operatingMargin: null, netMargin: null, debtToEquity: null, freeCashFlow: null,
      returnOnEquity: null, returnOnAssets: null, earningsSurprise: null, nextEarningsDate: null,
      ...overrides,
    },
  };
}

describe('voto PEG en confluencia (P/E ÷ crecimiento esperado)', () => {
  const allSignals = (d: ReturnType<typeof computeConfluenceDetail>) =>
    [...d.bullishSignals, ...d.bearishSignals, ...d.neutralSignals];

  it('PEG < 1 vota bullish (barato vs su crecimiento)', () => {
    const detail = computeConfluenceDetail(undefined, mkFund({ pegRatio: 0.8 }), undefined);
    expect(detail.bullishSignals).toContain('PEG 0.8 (barato vs crecimiento)');
  });

  it('PEG > 2 vota bearish (caro vs su crecimiento)', () => {
    const detail = computeConfluenceDetail(undefined, mkFund({ pegRatio: 2.5 }), undefined);
    expect(detail.bearishSignals).toContain('PEG 2.5 (caro vs crecimiento)');
  });

  it('PEG entre 1 y 2 vota neutral', () => {
    const detail = computeConfluenceDetail(undefined, mkFund({ pegRatio: 1.4 }), undefined);
    expect(detail.neutralSignals).toContain('PEG 1.4 (razonable)');
  });

  it('PEG null no genera voto (fail-closed, jamás neutral por default)', () => {
    const detail = computeConfluenceDetail(undefined, mkFund({ pegRatio: null }), undefined);
    expect(allSignals(detail).some(s => s.startsWith('PEG'))).toBe(false);
  });

  it('PEG negativo no genera voto (earnings o growth negativos = no interpretable)', () => {
    const detail = computeConfluenceDetail(undefined, mkFund({ pegRatio: -1.2 }), undefined);
    expect(allSignals(detail).some(s => s.startsWith('PEG'))).toBe(false);
  });
});
