import { describe, it, expect } from 'vitest';
import {
  buildDigestRecommendations,
  flagAlertedRecommendations,
  flagRearmedRecommendations,
  filterAvoidVsAlerts,
  type RecommendationSource,
} from './digest-recommendations.js';

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

describe('coherencia con alertas anticipatorias', () => {
  it('flagAlertedRecommendations marca anticipatoryAlert en filas cuyo simbolo tiene alerta activa', () => {
    const recs = [
      { symbol: 'GGAL', action: 'BUY' as const, reason: 'r', currentPrice: 50, score: 60 },
      { symbol: 'NVDA', action: 'WATCH' as const, reason: 'r', currentPrice: 900, score: 55 },
    ];
    const flagged = flagAlertedRecommendations(recs, new Set(['GGAL']));
    expect(flagged[0].anticipatoryAlert).toBe(true);
    expect(flagged[1].anticipatoryAlert).toBeUndefined();
  });

  it('filterAvoidVsAlerts elimina items que mencionan simbolos con alerta activa', () => {
    const avoid = ['Evitar GGAL hasta que confirme', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set(['GGAL']))).toEqual(['No tocar bonos largos']);
  });

  it('filterAvoidVsAlerts escapa caracteres especiales de regex en el simbolo (BTC-USD)', () => {
    const avoid = ['Evitar BTC-USD por volatilidad', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set(['BTC-USD']))).toEqual(['No tocar bonos largos']);
  });

  it('filterAvoidVsAlerts tambien elimina items que mencionan simbolos re-armados (rearmedSymbols) — doble discurso avoid vs rearm', () => {
    const avoid = ['Evitar PAM por riesgo elevado', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set(), new Set(['PAM']))).toEqual(['No tocar bonos largos']);
  });

  it('filterAvoidVsAlerts combina alertedSymbols y rearmedSymbols sin duplicar el filtrado', () => {
    const avoid = ['Evitar GGAL', 'Evitar PAM', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set(['GGAL']), new Set(['PAM']))).toEqual(['No tocar bonos largos']);
  });

  it('filterAvoidVsAlerts sin alertedSymbols ni rearmedSymbols devuelve la lista intacta', () => {
    const avoid = ['Evitar GGAL', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set())).toEqual(avoid);
  });

  it('flagRearmedRecommendations marca rearmAlert en filas cuyo simbolo re-armó (independiente de anticipatoryAlert)', () => {
    const recs = [
      { symbol: 'PAM', action: 'WATCH' as const, reason: 'r', currentPrice: 50, score: 63 },
      { symbol: 'NVDA', action: 'WATCH' as const, reason: 'r', currentPrice: 900, score: 55 },
    ];
    const flagged = flagRearmedRecommendations(recs, new Set(['PAM']));
    expect(flagged[0].rearmAlert).toBe(true);
    expect(flagged[1].rearmAlert).toBeUndefined();
    expect(flagged[0].anticipatoryAlert).toBeUndefined();
  });
});
