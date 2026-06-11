import { describe, it, expect } from 'vitest';
import { buildDigestRecommendations, type RecommendationSource } from './digest-recommendations.js';

function src(over: Partial<RecommendationSource> & { symbol: string }): RecommendationSource {
  return {
    action: 'BUY',
    currentPrice: 100,
    opportunityScore: 50,
    inPortfolio: false,
    simpleReasoning: 'razón del scan',
    reasoning: 'reasoning largo',
    catalysts: [],
    risks: [],
    ...over,
  };
}

const TL = { entryPrice: 48.04, stopLoss: 39.11, takeProfit: 55.25 };

describe('buildDigestRecommendations', () => {
  it('attaches tradeLevels and uses simpleReasoning for a portfolio BUY', () => {
    const { portfolioRecommendations } = buildDigestRecommendations([
      src({ symbol: 'YPF', action: 'BUY', inPortfolio: true, tradeLevels: TL, simpleReasoning: 'tendencia alcista' }),
    ]);
    expect(portfolioRecommendations).toHaveLength(1);
    expect(portfolioRecommendations[0]).toMatchObject({
      symbol: 'YPF', action: 'BUY', reason: 'tendencia alcista', tradeLevels: TL,
    });
  });

  it('does NOT attach tradeLevels to a HOLD/WATCH even when the scan has them (the bug)', () => {
    const { portfolioRecommendations } = buildDigestRecommendations([
      src({ symbol: 'GGAL', action: 'HOLD', inPortfolio: true, tradeLevels: TL }),
      src({ symbol: 'VIST', action: 'WATCH', inPortfolio: true, tradeLevels: TL }),
    ]);
    const ggal = portfolioRecommendations.find(r => r.symbol === 'GGAL')!;
    const vist = portfolioRecommendations.find(r => r.symbol === 'VIST')!;
    expect(ggal.action).toBe('HOLD');
    expect(ggal.tradeLevels).toBeUndefined();
    expect(vist.action).toBe('WATCH');
    expect(vist.tradeLevels).toBeUndefined();
  });

  it('partitions by inPortfolio', () => {
    const { portfolioRecommendations, marketRecommendations } = buildDigestRecommendations([
      src({ symbol: 'YPF', inPortfolio: true }),
      src({ symbol: 'LMT', inPortfolio: false }),
    ]);
    expect(portfolioRecommendations.map(r => r.symbol)).toEqual(['YPF']);
    expect(marketRecommendations.map(r => r.symbol)).toEqual(['LMT']);
  });

  it('excludes HOLD from the market block but keeps all actions for portfolio', () => {
    const { portfolioRecommendations, marketRecommendations } = buildDigestRecommendations([
      src({ symbol: 'OWNED', action: 'HOLD', inPortfolio: true }),
      src({ symbol: 'MKTHOLD', action: 'HOLD', inPortfolio: false }),
      src({ symbol: 'MKTBUY', action: 'BUY', inPortfolio: false }),
    ]);
    expect(portfolioRecommendations.map(r => r.symbol)).toContain('OWNED');
    expect(marketRecommendations.map(r => r.symbol)).toEqual(['MKTBUY']);
  });

  it('orders portfolio by action priority (SELL, BUY, WATCH, HOLD) then score desc', () => {
    const { portfolioRecommendations } = buildDigestRecommendations([
      src({ symbol: 'H', action: 'HOLD', inPortfolio: true, opportunityScore: 90 }),
      src({ symbol: 'W', action: 'WATCH', inPortfolio: true, opportunityScore: 90 }),
      src({ symbol: 'B1', action: 'BUY', inPortfolio: true, opportunityScore: 60 }),
      src({ symbol: 'B2', action: 'BUY', inPortfolio: true, opportunityScore: 80 }),
      src({ symbol: 'S', action: 'SELL', inPortfolio: true, opportunityScore: 10 }),
    ]);
    expect(portfolioRecommendations.map(r => r.symbol)).toEqual(['S', 'B2', 'B1', 'W', 'H']);
  });

  it('falls back through reasoning / catalysts / risks when simpleReasoning is empty', () => {
    const { marketRecommendations } = buildDigestRecommendations([
      src({ symbol: 'A', simpleReasoning: '', reasoning: 'usa reasoning' }),
      src({ symbol: 'B', simpleReasoning: undefined, reasoning: '', catalysts: ['usa catalyst'] }),
      src({ symbol: 'C', simpleReasoning: '', reasoning: '', catalysts: [], risks: ['usa risk'] }),
    ]);
    const by = (s: string) => marketRecommendations.find(r => r.symbol === s)!.reason;
    expect(by('A')).toBe('usa reasoning');
    expect(by('B')).toBe('usa catalyst');
    expect(by('C')).toBe('usa risk');
  });
});
