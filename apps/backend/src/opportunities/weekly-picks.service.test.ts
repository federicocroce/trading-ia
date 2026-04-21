import { describe, it, expect } from 'vitest';
import { assignTier, buildEvidenceDetail, getEvidenceType } from './weekly-picks.service.js';
import type { EvidenceSignal } from '@trading/shared';

// Minimal signal factory
function makeSignal(overrides: Partial<EvidenceSignal>): EvidenceSignal {
  return {
    symbol: 'TEST',
    scannedAt: new Date().toISOString(),
    conviction: 'high',
    regimeAdjustedConviction: 'high',
    activeSignals: 1,
    pead: { active: false, beatPercent: 0, daysSinceEarnings: 0, daysInDriftWindow: 0, score: 0, epsActual: null, epsEstimate: null, earningsDate: null, priceConfirmed: false, priceChangePct: null, consecutiveBeats: 0 },
    insider: { active: false, recentBuys: [], totalValue: 0, numberOfBuyers: 0, mostRecentBuyDate: null, score: 0 },
    optionsFlow: { active: false, callVolume: 0, putVolume: 0, callPutRatio: 0, nearestExpiry: null, dominantSentiment: 'neutral', score: 0, unusualStrikes: 0 },
    compositeScore: 0,
    recommendation: 'WATCH_CLOSELY',
    reasoning: '',
    ...overrides,
  } as EvidenceSignal;
}

describe('assignTier', () => {
  it('returns HIGH when conviction=high, score>=70, weeklyUp, sector!=LAGGING, regime!=bear', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 75, true, 'NEUTRAL', 'bull')).toBe('HIGH');
  });

  it('returns MEDIUM when conviction=high but weekly not up', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 75, false, 'NEUTRAL', 'bull')).toBe('MEDIUM');
  });

  it('returns MEDIUM when conviction=medium and sector is not LAGGING', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'medium' });
    expect(assignTier(signal, 75, true, 'NEUTRAL', 'bull')).toBe('MEDIUM');
  });

  it('returns null when conviction=medium and sector is LAGGING', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'medium' });
    expect(assignTier(signal, 75, true, 'LAGGING', 'bull')).toBeNull();
  });

  it('returns null when score < 70', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 65, true, 'NEUTRAL', 'bull')).toBeNull();
  });

  it('returns null when regime is bear', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 80, true, 'NEUTRAL', 'bear')).toBeNull();
  });
});

describe('getEvidenceType', () => {
  it('returns PEAD_INSIDER when both active', () => {
    const signal = makeSignal({
      pead: { active: true, beatPercent: 10, daysSinceEarnings: 3, daysInDriftWindow: 60, score: 80, epsActual: 1, epsEstimate: 0.9, earningsDate: '2024-01-01', priceConfirmed: true, priceChangePct: 5, consecutiveBeats: 2 },
      insider: { active: true, recentBuys: [], totalValue: 1000000, numberOfBuyers: 2, mostRecentBuyDate: '2024-01-01', score: 70 },
    });
    expect(getEvidenceType(signal)).toBe('PEAD_INSIDER');
  });

  it('returns PEAD when only pead active', () => {
    const signal = makeSignal({
      pead: { active: true, beatPercent: 10, daysSinceEarnings: 3, daysInDriftWindow: 60, score: 80, epsActual: 1, epsEstimate: 0.9, earningsDate: '2024-01-01', priceConfirmed: true, priceChangePct: 5, consecutiveBeats: 2 },
    });
    expect(getEvidenceType(signal)).toBe('PEAD');
  });
});
