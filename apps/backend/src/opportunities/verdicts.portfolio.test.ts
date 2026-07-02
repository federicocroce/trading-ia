import { describe, it, expect } from 'vitest';
import { resolveFinalVerdict, applyLlmAction } from './verdicts.service.js';

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

describe('applyLlmAction — el LLM solo puede degradar', () => {
  it('bloquea upgrade WATCH → BUY (vector del caso SDOT)', () => {
    expect(applyLlmAction('WATCH', 'BUY')).toBe('WATCH');
  });
  it('bloquea upgrade HOLD → BUY', () => {
    expect(applyLlmAction('HOLD', 'BUY')).toBe('HOLD');
  });
  it('permite degradar BUY → WATCH', () => {
    expect(applyLlmAction('BUY', 'WATCH')).toBe('WATCH');
  });
  it('permite degradar BUY → SELL', () => {
    expect(applyLlmAction('BUY', 'SELL')).toBe('SELL');
  });
  it('permite degradar HOLD → SELL (salida de posición)', () => {
    expect(applyLlmAction('HOLD', 'SELL')).toBe('SELL');
  });
  it('confirmación no cambia nada', () => {
    expect(applyLlmAction('BUY', 'BUY')).toBe('BUY');
  });
  it('acción desconocida del LLM no cambia nada', () => {
    expect(applyLlmAction('BUY', 'YOLO')).toBe('BUY');
  });
});

describe('resolveFinalVerdict — gate del LLM dentro de la cadena', () => {
  it('bloquea upgrade del llmAction (WATCH → BUY queda en WATCH)', () => {
    const v = resolveFinalVerdict({
      algoAction: 'WATCH', algoScore: 40, smartAction: 'WATCH',
      llmAction: 'BUY', llmReason: 'narrativa entusiasta',
    });
    expect(v.finalAction).toBe('WATCH');
    expect(v.source).not.toBe('llm');
    expect(v.trace.some(t => t.includes('bloqueado'))).toBe(true);
  });
  it('permite degradar via llmAction (BUY → WATCH, source=llm)', () => {
    const v = resolveFinalVerdict({
      algoAction: 'BUY', algoScore: 64, smartAction: 'BUY',
      llmAction: 'WATCH', llmReason: 'riesgo narrativo',
    });
    expect(v.finalAction).toBe('WATCH');
    expect(v.source).toBe('llm');
  });
});
