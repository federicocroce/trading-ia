import { describe, it, expect } from 'vitest';
import { shouldTrackSignal, type TrackableOpportunity } from './signal-tracking.service.js';

const trigger = (type: string, direction: 'bullish' | 'bearish' | 'neutral', estimatedDays: number | null) => ({
  type, direction, estimatedDays, description: `${type} ${direction} ~${estimatedDays}d`, impact: 'high' as const,
});

function makeOpp(overrides: Partial<TrackableOpportunity> = {}): TrackableOpportunity {
  return {
    action: 'WATCH',
    timingView: undefined,
    tradeLevels: undefined,
    ...overrides,
  };
}

describe('shouldTrackSignal', () => {
  it('BUY siempre se trackea', () => {
    expect(shouldTrackSignal(makeOpp({ action: 'BUY' }))).toBe(true);
  });

  it('SELL siempre se trackea', () => {
    expect(shouldTrackSignal(makeOpp({ action: 'SELL' }))).toBe(true);
  });

  it('WATCH sin timing activo y setup valido NO se trackea', () => {
    expect(shouldTrackSignal(makeOpp({
      action: 'WATCH',
      tradeLevels: { entryPrice: 100, stopLoss: 95, takeProfit: 110, riskRewardRatio: 2, entryReason: '', stopReason: '', targetReason: '', setupQuality: 'valid' },
    }))).toBe(false);
  });

  it('WATCH con timing now/soon y 2+ triggers se trackea (señal de anticipación)', () => {
    expect(shouldTrackSignal(makeOpp({
      action: 'WATCH',
      timingView: { action: 'BUY', timing: 'soon', confidence: 70, triggers: [trigger('rsi_divergence', 'bullish', 3), trigger('obv_divergence', 'bullish', 2)] },
    }))).toBe(true);
  });

  it('WATCH con timing pero solo 1 trigger NO se trackea', () => {
    expect(shouldTrackSignal(makeOpp({
      action: 'WATCH',
      timingView: { action: 'BUY', timing: 'now', confidence: 70, triggers: [trigger('rsi_zone', 'bullish', 0)] },
    }))).toBe(false);
  });

  it('WATCH con setup invalido (BUY degradado por el clamp de riesgo del P1) se trackea', () => {
    expect(shouldTrackSignal(makeOpp({
      action: 'WATCH',
      tradeLevels: { entryPrice: 100, stopLoss: 50, takeProfit: 110, riskRewardRatio: 0.2, entryReason: '', stopReason: '', targetReason: '', setupQuality: 'invalid', setupWarning: 'riesgo del setup 50.0% > máximo 10% — no operar' },
    }))).toBe(true);
  });

  it('HOLD nunca se trackea, incluso con setup invalido', () => {
    expect(shouldTrackSignal(makeOpp({
      action: 'HOLD',
      tradeLevels: { entryPrice: 100, stopLoss: 50, takeProfit: 110, riskRewardRatio: 0.2, entryReason: '', stopReason: '', targetReason: '', setupQuality: 'invalid' },
    }))).toBe(false);
  });
});
