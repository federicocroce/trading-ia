import { describe, it, expect } from 'vitest';
import { findRelatedSymbols } from './newsapi.adapter.js';

/**
 * Regression tests for the actual root cause of the "ROAD" hallucination — same bug as
 * rss.adapter.ts (see rss.adapter.test.ts and ticker-extraction.ts for the full story).
 * Confirmed in prod (data/trading.db): a NewsAPI article about the Comcast/NBCUniversal
 * spinoff had related_symbols including "AS","CAST","FT","OMC","AD","TECH","ON","TER","DMA".
 */
describe('newsapi.adapter findRelatedSymbols', () => {
  const prodSymbols = ['AS', 'RS', 'CAST', 'OMC', 'AD', 'FT', 'TECH', 'ON', 'HON', 'TER', 'DMA', 'EV', 'CMCSA'];

  it('does NOT tag CAST/OMC/AD/AS/FT/TECH/ON on the exact prod headline that caused the bug', () => {
    const result = findRelatedSymbols(
      'Comcast soars 23% after announcing it will spin off media and tech wings into separate public companies',
      null,
      prodSymbols,
    );
    expect(result).toEqual([]);
  });

  it('still tags a symbol that is a real ALL-CAPS mention in the title', () => {
    const result = findRelatedSymbols('CMCSA beats revenue estimates', null, prodSymbols);
    expect(result).toContain('CMCSA');
  });

  it('still tags XOM/CVX via curated word aliases', () => {
    expect(findRelatedSymbols('Exxon posts record quarterly profit', null, ['XOM'])).toEqual(['XOM']);
    expect(findRelatedSymbols('Chevron raises dividend guidance', null, ['CVX'])).toEqual(['CVX']);
  });

  it('does not tag a symbol absent from both text and universe', () => {
    expect(findRelatedSymbols('Some unrelated headline', null, ['AAPL'])).toEqual([]);
  });
});
