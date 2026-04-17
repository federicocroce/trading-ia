// apps/backend/src/quant/momentum-ranker.service.ts
import type { TechnicalSummary, MomentumRanking } from '@trading/shared';

export function rankMomentum(summaries: TechnicalSummary[]): MomentumRanking[] {
  const valid = summaries.filter(s => s.indicators.currentPrice > 0);
  if (valid.length === 0) return [];

  // absoluteMomentum: priceVsSma50 (% distance from 50-day SMA, proxy for 20d momentum)
  const withMomentum = valid.map(s => ({
    symbol: s.symbol,
    absoluteMomentum: s.indicators.priceVsSma50 ?? 0,
  }));

  // Market reference: median momentum across all assets
  const sorted = [...withMomentum].sort((a, b) => a.absoluteMomentum - b.absoluteMomentum);
  const mid = Math.floor(sorted.length / 2);
  const medianMom = sorted.length % 2 === 0
    ? (sorted[mid - 1].absoluteMomentum + sorted[mid].absoluteMomentum) / 2
    : sorted[mid].absoluteMomentum;

  // relativeStrength: how much this asset outperforms the median
  const withRelative = withMomentum.map(s => ({
    ...s,
    relativeStrength: s.absoluteMomentum - medianMom,
  }));

  // Sort descending by relativeStrength → rank 1 = strongest
  const ranked = [...withRelative].sort((a, b) => b.relativeStrength - a.relativeStrength);
  const n = ranked.length;

  return ranked.map((s, i) => ({
    symbol: s.symbol,
    rank: i + 1,
    relativeStrength: Math.round(s.relativeStrength * 100) / 100,
    absoluteMomentum: Math.round(s.absoluteMomentum * 100) / 100,
    percentile: Math.round(((n - i - 1) / n) * 100),
  }));
}
