import { describe, it, expect } from 'vitest';
import {
  buildPortfolioContext, computePortfolioAdjustment, buildPortfolioDiagnostic,
} from './portfolio-risk.service.js';

const HOLDINGS = [
  { symbol: 'YPF', value: 8000, returns: [0.01, -0.02, 0.03, 0.01] },
  { symbol: 'PAM', value: 6000, returns: [0.011, -0.019, 0.031, 0.009] },
  { symbol: 'VIST', value: 6000, returns: [0.009, -0.021, 0.029, 0.012] },
];

describe('buildPortfolioContext', () => {
  it('computes value-weighted factor concentration', () => {
    const ctx = buildPortfolioContext(HOLDINGS);
    expect(ctx.factorWeights.oil).toBeCloseTo(1.0, 5);
    expect(ctx.factorSymbols.oil?.sort()).toEqual(['PAM', 'VIST', 'YPF']);
    expect(ctx.totalValue).toBe(20000);
  });
  it('handles empty portfolio', () => {
    const ctx = buildPortfolioContext([]);
    expect(ctx.totalValue).toBe(0);
    expect(ctx.factorWeights).toEqual({});
  });
});

describe('computePortfolioAdjustment', () => {
  const ctx = buildPortfolioContext(HOLDINGS);

  it('flags an oil candidate as stacking (correlated with heavy factor)', () => {
    const adj = computePortfolioAdjustment('EOG', ['oil', 'us-equity'],
      [0.0105, -0.0205, 0.0305, 0.0102], ctx, 1);
    expect(adj.verdict).toBe('stacks');
    expect(adj.rawDelta).toBeLessThan(0);
    expect(adj.delta).toBe(adj.rawDelta); // intensity 1
    expect(adj.reason).toMatch(/oil/);
  });

  it('rewards a true diversifier (new factor, low correlation)', () => {
    const adj = computePortfolioAdjustment('GLD', ['gold', 'safe-haven'],
      [-0.01, 0.02, -0.03, 0.0], ctx, 1);
    expect(adj.verdict).toBe('diversifies');
    expect(adj.rawDelta).toBeGreaterThan(0);
  });

  it('dial at 0 produces delta 0 but keeps rawDelta (trace only)', () => {
    const adj = computePortfolioAdjustment('EOG', ['oil', 'us-equity'],
      [0.0105, -0.0205, 0.0305, 0.0102], ctx, 0);
    expect(adj.delta).toBe(0);
    expect(adj.rawDelta).toBeLessThan(0);
  });

  it('is neutral for empty portfolio', () => {
    const empty = buildPortfolioContext([]);
    const adj = computePortfolioAdjustment('EOG', ['oil'], [0.01], empty, 1);
    expect(adj.verdict).toBe('neutral');
    expect(adj.delta).toBe(0);
  });

  // Coherencia con el módulo Cartera (regla dura #4): los instrumentos estructurales
  // (whitelists núcleo/cobertura) jamás pueden marcarse como "apilan tu riesgo" —
  // el diagnóstico decía "SPY apila" mientras Cartera decía "comprá SPY".
  it('SPY (núcleo estructural) jamás es stacks aunque correlacione con factores pesados', () => {
    const riskOnHoldings = [
      { symbol: 'GGAL', value: 10_000, returns: [0.01, -0.02, 0.03, 0.01] },
      { symbol: 'MARA', value: 10_000, returns: [0.012, -0.018, 0.028, 0.011] },
    ];
    const riskCtx = buildPortfolioContext(riskOnHoldings);
    const adj = computePortfolioAdjustment('SPY', ['us-equity', 'risk-on'],
      [0.0105, -0.0195, 0.0295, 0.0105], riskCtx, 1);
    expect(adj.verdict).toBe('neutral');
    expect(adj.delta).toBe(0);
    expect(adj.reason).toMatch(/estructural/i);
  });

  it('GLD (cobertura estructural) conserva el veredicto diversifies — el guard solo exime del castigo', () => {
    const adj = computePortfolioAdjustment('GLD', ['gold', 'safe-haven'],
      [-0.01, 0.02, -0.03, 0.0], ctx, 1);
    expect(adj.verdict).toBe('diversifies');
    expect(adj.rawDelta).toBeGreaterThan(0);
  });

  it('una acción común sigue pudiendo apilar (el guard es solo para estructurales)', () => {
    const adj = computePortfolioAdjustment('EOG', ['oil', 'us-equity'],
      [0.0105, -0.0205, 0.0305, 0.0102], ctx, 1);
    expect(adj.verdict).toBe('stacks');
  });
});

describe('buildPortfolioDiagnostic', () => {
  const ctx = buildPortfolioContext(HOLDINGS); // 100% oil, no hedges
  it('flags concentration and missing hedge', () => {
    const diag = buildPortfolioDiagnostic(ctx, [
      { symbol: 'GLD', verdict: 'diversifies' },
      { symbol: 'EOG', verdict: 'stacks' },
    ]);
    expect(diag.factorExposure.find(f => f.factor === 'oil')?.weight).toBeCloseTo(1, 5);
    expect(diag.concentrationFlags.some(s => /oil/.test(s))).toBe(true);
    expect(diag.missingHedges.length).toBeGreaterThan(0);
    expect(diag.diversifiers).toContain('GLD');
    expect(diag.stackers).toContain('EOG');
  });
  it('reports empty portfolio cleanly', () => {
    const diag = buildPortfolioDiagnostic(buildPortfolioContext([]), []);
    expect(diag.factorExposure).toEqual([]);
    expect(diag.concentrationFlags).toEqual([]);
  });
});
