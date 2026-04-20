import { describe, it, expect } from 'vitest';
import { computeEntryScore } from './scoring.js';

describe('computeEntryScore', () => {
  it('returns low score for overbought RSI with conflicts', () => {
    const score = computeEntryScore({
      rsi: 96,
      riskReward: 1.2,
      conflictCount: 1,
      timingConfidence: 50,
      currentPrice: 4.86,
      stopLoss: 4.20,
    });
    expect(score).toBeLessThan(45);
  });

  it('returns high score for oversold RSI, good R/R, no conflicts', () => {
    const score = computeEntryScore({
      rsi: 32,
      riskReward: 2.8,
      conflictCount: 0,
      timingConfidence: 80,
      currentPrice: 187,
      stopLoss: 183,
    });
    expect(score).toBeGreaterThan(75);
  });

  it('uses neutral fallbacks when optional fields are missing', () => {
    const score = computeEntryScore({
      rsi: null,
      riskReward: null,
      conflictCount: 0,
      timingConfidence: null,
      currentPrice: 100,
      stopLoss: null,
    });
    // All neutrals: RSI=50, R/R=40, conflicts=100, timing=50, support=50
    // = 50*0.25 + 40*0.25 + 100*0.25 + 50*0.15 + 50*0.10 = 12.5+10+25+7.5+5 = 60
    expect(score).toBe(60);
  });

  it('returns low score for RSI > 75, 3 conflicts, 0 timing', () => {
    const score = computeEntryScore({
      rsi: 80,
      riskReward: null,
      conflictCount: 3,
      timingConfidence: 0,
      currentPrice: 100,
      stopLoss: null,
    });
    // RSI=0, R/R=40, conflicts=0, timing=0, support=50
    // = 0*0.25 + 40*0.25 + 0*0.25 + 0*0.15 + 50*0.10 = 0+10+0+0+5 = 15
    expect(score).toBe(15);
  });

  it('inverts RSI logic for SELL signals — high RSI is good entry', () => {
    const score = computeEntryScore({
      rsi: 78,
      riskReward: 2.8,
      conflictCount: 0,
      timingConfidence: 80,
      currentPrice: 100,
      stopLoss: null,
      action: 'SELL',
    });
    // RSI=100 (>=70), R/R=100, conflicts=100, timing=80, support=50
    // = 100*0.25 + 100*0.25 + 100*0.25 + 80*0.15 + 50*0.10 = 25+25+25+12+5 = 92
    expect(score).toBe(92);
  });

  it('clamps timingConfidence above 100 to 100', () => {
    const score = computeEntryScore({
      rsi: null,
      riskReward: null,
      conflictCount: 0,
      timingConfidence: 150,
      currentPrice: 100,
      stopLoss: null,
    });
    // RSI=50, R/R=40, conflicts=100, timing=100 (clamped), support=50
    // = 50*0.25 + 40*0.25 + 100*0.25 + 100*0.15 + 50*0.10 = 12.5+10+25+15+5 = 68 (rounded)
    expect(score).toBe(68);
  });
});
