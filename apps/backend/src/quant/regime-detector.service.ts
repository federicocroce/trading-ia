// apps/backend/src/quant/regime-detector.service.ts
import type { TechnicalSummary } from '@trading/shared';
import type { RegimeResult, MarketRegime } from '@trading/shared';

export function detectRegime(summaries: TechnicalSummary[]): RegimeResult {
  const valid = summaries.filter(s => s.indicators.currentPrice > 0);

  if (valid.length < 5) {
    return {
      regime: 'unknown',
      confidence: 0,
      indicators: { adxValue: 0, atrRatio: 0, trendConsistency: 0, spyMomentum: 0 },
      detectedAt: new Date().toISOString(),
    };
  }

  // trendConsistency: % of assets with price > SMA200
  const aboveSma200 = valid.filter(s => s.indicators.priceVsSma200 > 0).length;
  const trendConsistency = aboveSma200 / valid.length;

  // adxProxy: avg(|RSI - 50| * 2) — higher = more directional market
  const rsiValues = valid
    .map(s => s.indicators.rsi14)
    .filter((v): v is number => v != null);
  const adxValue = rsiValues.length > 0
    ? rsiValues.reduce((sum, rsi) => sum + Math.abs(rsi - 50) * 2, 0) / rsiValues.length
    : 25;

  // atrRatio: avg(ATR14 / price) — volatility relative to price
  const atrRatios = valid
    .filter(s => s.indicators.atr14 != null && s.indicators.currentPrice > 0)
    .map(s => s.indicators.atr14! / s.indicators.currentPrice);
  const atrRatio = atrRatios.length > 0
    ? atrRatios.reduce((a, b) => a + b, 0) / atrRatios.length
    : 0.015;

  // spyMomentum proxy: normalized % of assets above SMA50 (-1 to +1)
  const aboveSma50 = valid.filter(s => s.indicators.priceVsSma50 > 0).length;
  const spyMomentum = (aboveSma50 / valid.length - 0.5) * 2;

  let regime: MarketRegime;
  let confidence: number;

  if (atrRatio > 0.025) {
    regime = 'volatile';
    confidence = Math.min(100, Math.round((atrRatio - 0.025) / 0.015 * 100) + 20);
  } else if (trendConsistency > 0.65 && adxValue > 30 && spyMomentum > 0) {
    regime = 'trending_bull';
    const c1 = ((trendConsistency - 0.65) / 0.35) * 40;
    const c2 = Math.min(1, (adxValue - 30) / 20) * 40;
    const c3 = spyMomentum * 20;
    confidence = Math.min(100, Math.max(20, Math.round(c1 + c2 + c3)));
  } else if (trendConsistency < 0.35 && adxValue > 30 && spyMomentum < 0) {
    regime = 'trending_bear';
    const c1 = ((0.35 - trendConsistency) / 0.35) * 40;
    const c2 = Math.min(1, (adxValue - 30) / 20) * 40;
    const c3 = Math.abs(spyMomentum) * 20;
    confidence = Math.min(100, Math.max(20, Math.round(c1 + c2 + c3)));
  } else {
    regime = 'mean_reverting';
    confidence = Math.max(20, Math.round(50 - Math.abs(trendConsistency - 0.5) * 60));
  }

  return {
    regime,
    confidence,
    indicators: {
      adxValue: Math.round(adxValue),
      atrRatio: Math.round(atrRatio * 1000) / 1000,
      trendConsistency: Math.round(trendConsistency * 100),
      spyMomentum: Math.round(spyMomentum * 100) / 100,
    },
    detectedAt: new Date().toISOString(),
  };
}

export function getRegimeWeightAdjustment(regime: MarketRegime): {
  shortTerm: { sentiment: number; technical: number; fundamental: number };
  mediumTerm: { sentiment: number; technical: number; fundamental: number };
} {
  const adj = {
    trending_bull:   { shortTerm: { sentiment: 0.05, technical: 0.10, fundamental: -0.15 }, mediumTerm: { sentiment: 0.05, technical: 0.10, fundamental: -0.15 } },
    trending_bear:   { shortTerm: { sentiment: 0.10, technical: 0.10, fundamental: -0.20 }, mediumTerm: { sentiment: 0.10, technical: 0.10, fundamental: -0.20 } },
    mean_reverting:  { shortTerm: { sentiment: -0.05, technical: 0.10, fundamental: -0.05 }, mediumTerm: { sentiment: -0.05, technical: 0.10, fundamental: -0.05 } },
    volatile:        { shortTerm: { sentiment: -0.10, technical: -0.05, fundamental: 0.15 }, mediumTerm: { sentiment: -0.10, technical: -0.05, fundamental: 0.15 } },
    unknown:         { shortTerm: { sentiment: 0, technical: 0, fundamental: 0 }, mediumTerm: { sentiment: 0, technical: 0, fundamental: 0 } },
  };
  return adj[regime];
}
