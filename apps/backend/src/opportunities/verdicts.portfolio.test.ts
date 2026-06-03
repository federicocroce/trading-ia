import { describe, it, expect } from 'vitest';
import { resolveFinalVerdict } from './verdicts.service.js';

describe('resolveFinalVerdict with portfolioAdjustment', () => {
  it('adds a portfolio trace layer showing the delta', () => {
    const v = resolveFinalVerdict({
      algoAction: 'BUY', algoScore: 64, smartAction: 'BUY',
      portfolioAdjustment: { delta: -4, rawDelta: -8, intensity: 0.5, concentration: [],
        verdict: 'stacks', reason: 'Apila riesgo oil (ya 40% en YPF/PAM/VIST, corr 0.78).' },
    });
    expect(v.trace.some(t => t.startsWith('portfolio:'))).toBe(true);
    expect(v.trace.find(t => t.startsWith('portfolio:'))).toMatch(/oil/);
  });
  it('shows delta 0 when dial is off', () => {
    const v = resolveFinalVerdict({
      algoAction: 'BUY', algoScore: 64, smartAction: 'BUY',
      portfolioAdjustment: { delta: 0, rawDelta: -8, intensity: 0, concentration: [],
        verdict: 'stacks', reason: 'Apila riesgo oil.' },
    });
    const layer = v.trace.find(t => t.startsWith('portfolio:'));
    expect(layer).toMatch(/Δ-8×0=0/);
  });
  it('omits the layer when there is no adjustment or it is neutral', () => {
    const v = resolveFinalVerdict({ algoAction: 'BUY', algoScore: 64, smartAction: 'BUY' });
    expect(v.trace.some(t => t.startsWith('portfolio:'))).toBe(false);
  });
});
