import { describe, it, expect } from 'vitest';
import { detectStopBreaches } from './stop-breach.service.js';

const pos = (symbol: string) => ({ symbol, quantity: 10, avgCost: 50 });
const opp = (symbol: string, stopLoss: number) => ({
  symbol, inPortfolio: true, tradeLevels: { entryPrice: 50, stopLoss, takeProfit: 60 },
});

describe('detectStopBreaches', () => {
  const TODAY = '2026-06-11';

  it('precio < stop → alerta stop_breach con id estable stop:SYMBOL', () => {
    const breaches = detectStopBreaches(
      [pos('GGAL')],
      [opp('GGAL', 46)],
      new Map([['GGAL', 45.5]]),
      TODAY,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0].id).toBe('stop:GGAL');
    expect(breaches[0].kind).toBe('stop_breach');
    expect(breaches[0].stopLoss).toBe(46);
    expect(breaches[0].currentPrice).toBe(45.5);
    expect(breaches[0].signals[0].description).toContain('perforó el stop');
  });

  it('precio >= stop → sin alerta', () => {
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map([['GGAL', 46.0]]), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map([['GGAL', 48]]), TODAY)).toHaveLength(0);
  });

  it('sin tradeLevels, sin quote o fuera de portfolio → sin alerta', () => {
    expect(detectStopBreaches([pos('GGAL')], [{ symbol: 'GGAL', inPortfolio: true }], new Map([['GGAL', 1]]), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map(), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([], [opp('GGAL', 46)], new Map([['GGAL', 45]]), TODAY)).toHaveLength(0);
  });
});
