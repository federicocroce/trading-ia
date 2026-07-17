import { describe, it, expect } from 'vitest';
import { applyAntiHypeFilters } from './scoring.js';
import type { TechnicalSummary } from '@trading/shared';

// TechnicalSummary mínimo para el anti-hype: solo lee sma200, rsi14, volumeRatio, currentPrice.
function mkTech(overrides: Partial<TechnicalSummary['indicators']>): TechnicalSummary {
  return {
    symbol: 'TEST',
    signal: 'neutral',
    score: 0,
    timing: null,
    indicators: {
      rsi14: 50, macd: null, sma20: null, sma50: null, sma200: 90,
      bollingerBands: null, currentPrice: 100,
      priceVsSma20: 0, priceVsSma50: 0, priceVsSma200: 0,
      volumeRatio: 1.2, stochastic: null, atr14: null, atrPercent: null,
      obvTrend: null, obvDivergence: false, supports: [], resistances: [],
      nearestSupport: null, nearestResistance: null, crossovers: null,
      bbSqueeze: false, bbSqueezeIntensity: null,
      ...overrides,
    },
  };
}

describe('applyAntiHypeFilters — fail-closed sin datos técnicos', () => {
  it('símbolo SIN tech en el mapa se RECHAZA (dato faltante = rechazo, regla #1)', () => {
    const result = applyAntiHypeFilters(['NODATA'], new Map(), new Set(), { includeVolume: true });
    expect(result.filtered).not.toContain('NODATA');
    expect(result.rejected.map(r => r.symbol)).toContain('NODATA');
    const reasons = result.rejected.find(r => r.symbol === 'NODATA')!.reasons;
    expect(reasons.join(' ')).toMatch(/sin datos técnicos/i);
  });

  it('símbolo de portfolio SIN tech sigue pasando (necesario para señales SELL)', () => {
    const result = applyAntiHypeFilters(['MYPOS'], new Map(), new Set(['MYPOS']), { includeVolume: true });
    expect(result.filtered).toContain('MYPOS');
  });

  it('símbolo con bypass de noticias de alto impacto SIN tech sigue pasando (excepción deliberada)', () => {
    const result = applyAntiHypeFilters(['NEWSY'], new Map(), new Set(), {
      includeVolume: true,
      newsImpactBypass: new Set(['NEWSY']),
    });
    expect(result.filtered).toContain('NEWSY');
  });

  it('símbolo CON tech que pasa los filtros sigue pasando (sin regresión)', () => {
    const techMap = new Map([['GOOD', mkTech({})]]); // precio>SMA200, RSI 50, volumen 1.2x
    const result = applyAntiHypeFilters(['GOOD'], techMap, new Set(), { includeVolume: true });
    expect(result.filtered).toContain('GOOD');
  });

  it('símbolo CON tech que falla 2 de 3 se rechaza (comportamiento existente intacto)', () => {
    const techMap = new Map([['BAD', mkTech({ sma200: 110, volumeRatio: 0.5 })]]); // precio<SMA200 + volumen bajo
    const result = applyAntiHypeFilters(['BAD'], techMap, new Set(), { includeVolume: true });
    expect(result.rejected.map(r => r.symbol)).toContain('BAD');
  });
});
