import { describe, it, expect } from 'vitest';
import { detectRearmedSetups, type RearmSource } from './rearm-detector.js';

function mkOpp(symbol: string, overrides: { action: RearmSource['action']; score: number; setupQuality?: 'valid' | 'invalid' }): RearmSource {
  return {
    symbol,
    action: overrides.action,
    opportunityScore: overrides.score,
    currentPrice: 100,
    tradeLevels: {
      entryPrice: 100,
      stopLoss: 92,
      takeProfit: 116,
      setupQuality: overrides.setupQuality,
    },
  };
}

describe('detectRearmedSetups — degradados que se vuelven operables', () => {
  it('detecta: ayer invalid, hoy valid con BUY/WATCH y score decente', () => {
    const today = [mkOpp('PAM', { action: 'WATCH', score: 63, setupQuality: 'valid' })];
    const out = detectRearmedSetups(today, new Set(['PAM']));
    expect(out.map(r => r.symbol)).toEqual(['PAM']);
  });

  it('NO detecta si hoy sigue invalid', () => {
    const today = [mkOpp('GGAL', { action: 'WATCH', score: 62, setupQuality: 'invalid' })];
    expect(detectRearmedSetups(today, new Set(['GGAL']))).toEqual([]);
  });

  it('NO detecta si ayer no era invalid (no hay transición)', () => {
    const today = [mkOpp('TSM', { action: 'BUY', score: 70, setupQuality: 'valid' })];
    expect(detectRearmedSetups(today, new Set())).toEqual([]);
  });

  it('exige score mínimo 55 y action BUY o WATCH', () => {
    const today = [
      mkOpp('LOW', { action: 'WATCH', score: 40, setupQuality: 'valid' }),
      mkOpp('HOLD1', { action: 'HOLD', score: 70, setupQuality: 'valid' }),
    ];
    expect(detectRearmedSetups(today, new Set(['LOW', 'HOLD1']))).toEqual([]);
  });

  it('devuelve los niveles del setup de HOY (entry/stop/target/score)', () => {
    const today = [mkOpp('PAM', { action: 'BUY', score: 71, setupQuality: 'valid' })];
    const [candidate] = detectRearmedSetups(today, new Set(['PAM']));
    expect(candidate).toEqual({
      symbol: 'PAM',
      entryPrice: 100,
      stopLoss: 92,
      takeProfit: 116,
      score: 71,
    });
  });

  it('sin tradeLevels hoy → no puede haber rearmado (no hay setup operable que reportar)', () => {
    const today: RearmSource[] = [{
      symbol: 'NOLV', action: 'WATCH', opportunityScore: 80, currentPrice: 50, tradeLevels: undefined,
    }];
    expect(detectRearmedSetups(today, new Set(['NOLV']))).toEqual([]);
  });
});
