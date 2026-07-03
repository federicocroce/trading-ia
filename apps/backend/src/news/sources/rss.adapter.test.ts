import { describe, it, expect } from 'vitest';
import { findRelatedSymbols } from './rss.adapter.js';

/**
 * Regression tests for the actual root cause of the "ROAD" hallucination (see
 * apps/backend/src/news/ticker-extraction.ts header comment for the full story).
 *
 * Pre-fix, `findRelatedSymbols` uppercased the whole text and ran `text.includes(SYMBOL)` —
 * a case-insensitive substring match. Confirmed in prod (data/trading.db, news_articles):
 * title="Liberty Broadband stock surges 15% on Comcast spinoff news" (source="RSS:All News")
 * had related_symbols=["GE","AS","CAST","OMC","AD","ROAD"]. None of those are real ALL-CAPS
 * tokens in the original headline — they're all substrings of mixed-case words
 * ("B-ROAD-band", "Com-CAST", "sur-GE-s", "Comc-AS-t", "c-OMC-ast", "bro-AD-band").
 */
describe('rss.adapter findRelatedSymbols', () => {
  const prodSymbols = ['GE', 'AS', 'CAST', 'OMC', 'AD', 'ROAD', 'RS', 'FT', 'ON', 'HON', 'TER', 'DMA', 'EV', 'CMCSA', 'LBRDA'];

  it('does NOT tag ROAD/CAST/OMC/AD/AS/GE on the exact prod headline that caused the bug', () => {
    const result = findRelatedSymbols(
      'Liberty Broadband stock surges 15% on Comcast spinoff news',
      undefined,
      prodSymbols,
    );
    expect(result).toEqual([]);
  });

  it('still tags a symbol that is a real ALL-CAPS mention in the title', () => {
    const result = findRelatedSymbols('CMCSA beats revenue, earnings expectations', undefined, prodSymbols);
    expect(result).toContain('CMCSA');
  });

  it('still tags BTC-USD/ETH-USD via curated word aliases', () => {
    expect(findRelatedSymbols('Bitcoin rallies to new highs', undefined, ['BTC-USD'])).toEqual(['BTC-USD']);
    expect(findRelatedSymbols('Ethereum network upgrade goes live', undefined, ['ETH-USD'])).toEqual(['ETH-USD']);
  });

  it('does not tag a symbol absent from both text and universe', () => {
    expect(findRelatedSymbols('Some unrelated headline', undefined, ['AAPL'])).toEqual([]);
  });
});
