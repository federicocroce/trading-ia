import { describe, it, expect } from 'vitest';
import { groundWouldBuyItems, type GroundingOpp } from './digest-grounding.js';

const GGAL: GroundingOpp = {
  symbol: 'GGAL', action: 'BUY', currentPrice: 47.81,
  tradeLevels: { entryPrice: 47.81, stopLoss: 39.11, takeProfit: 60.86 },
};
const SMCI: GroundingOpp = { symbol: 'SMCI', action: 'BUY', currentPrice: 42.88 }; // no tradeLevels
const XLE: GroundingOpp = { symbol: 'XLE', action: 'WATCH', currentPrice: 58.40 };

describe('groundWouldBuyItems', () => {
  it('drops a would-buy item whose ticker is not a BUY (the XLE hallucination)', () => {
    const out = groundWouldBuyItems(
      ['Compraría XLE a $88.50 — el sector energético se beneficia. Stop $85.00, target $92.00.'],
      [GGAL, XLE],
    );
    expect(out).toEqual([]);
  });

  it('replaces fabricated numbers with the scan tradeLevels for a real BUY', () => {
    const out = groundWouldBuyItems(
      ['Compraría GGAL a $99.00 — noticias positivas y tendencia alcista. Stop $10.00, target $200.00.'],
      [GGAL],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('$99');
    expect(out[0]).not.toContain('$200');
    expect(out[0]).toContain('39.11');   // real stop
    expect(out[0]).toContain('60.86');   // real target
    expect(out[0]).toContain('noticias positivas'); // narrative preserved
  });

  it('keeps narrative but strips numbers when the BUY opp has no tradeLevels', () => {
    const out = groundWouldBuyItems(
      ['Compraría SMCI a $42.88 — fuerte demanda IA. Stop $28.29, target $64.77.'],
      [SMCI],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).not.toMatch(/\$\d/); // no dollar-number survives
    expect(out[0]).toContain('demanda IA');
  });

  it('drops an item that names only a non-BUY known ticker', () => {
    expect(groundWouldBuyItems(['Mantendría XLE en observación toda la semana próxima.'], [GGAL, XLE])).toEqual([]);
  });

  it('drops an item with no ticker token at all', () => {
    expect(groundWouldBuyItems(['Esperaría señales más claras antes de actuar en general.'], [GGAL])).toEqual([]);
  });
});
