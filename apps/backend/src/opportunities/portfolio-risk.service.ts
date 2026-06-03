import type {
  RiskFactor, PortfolioContext, PortfolioAdjustment, PortfolioConcentration,
  PortfolioDiagnostic, MissingHedge,
} from '@trading/shared';
import { HEDGE_FACTORS } from '@trading/shared';
import { pearson } from './correlation.js';
import { factorsForSymbol } from './risk-factor-map.js';

export interface HoldingInput {
  symbol: string;
  value: number;       // position market value
  returns: number[];   // daily returns, recent last
  sector?: string;
}

const FACTOR_THRESHOLD = Number(process.env.PORTFOLIO_FACTOR_THRESHOLD ?? '0.30');
const STACK_CORR = 0.6;          // correlation that confirms "same risk"
const MAX_RAW_DELTA = 12;        // cap, in composite points

export function buildPortfolioContext(holdings: HoldingInput[]): PortfolioContext {
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const factorWeights: Partial<Record<RiskFactor, number>> = {};
  const factorSymbols: Partial<Record<RiskFactor, string[]>> = {};
  const returns: Record<string, number[]> = {};

  for (const h of holdings) {
    returns[h.symbol.toUpperCase()] = h.returns;
    const factors = factorsForSymbol(h.symbol, h.sector);
    const w = totalValue > 0 ? h.value / totalValue : 0;
    for (const f of factors) {
      factorWeights[f] = (factorWeights[f] ?? 0) + w;
      (factorSymbols[f] ??= []).push(h.symbol.toUpperCase());
    }
  }
  return { factorWeights, factorSymbols, returns, totalValue };
}

/** Average correlation of a candidate's returns vs the holdings in a given factor. */
function avgCorrelationToFactor(
  candidateReturns: number[], factor: RiskFactor, ctx: PortfolioContext,
): number {
  const syms = ctx.factorSymbols[factor] ?? [];
  const corrs: number[] = [];
  for (const s of syms) {
    const r = ctx.returns[s];
    if (!r || r.length < 2 || candidateReturns.length < 2) continue;
    const c = pearson(candidateReturns, r);
    if (!Number.isNaN(c)) corrs.push(c);
  }
  if (corrs.length === 0) return NaN;
  return corrs.reduce((a, b) => a + b, 0) / corrs.length;
}

export function computePortfolioAdjustment(
  symbol: string,
  candidateFactors: RiskFactor[],
  candidateReturns: number[],
  ctx: PortfolioContext,
  intensity: number,
): PortfolioAdjustment {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  if (ctx.totalValue === 0 || candidateFactors.length === 0) {
    return { delta: 0, rawDelta: 0, intensity: clampedIntensity, concentration: [], verdict: 'neutral',
      reason: ctx.totalValue === 0 ? 'Sin cartera de referencia.' : 'Sin factores clasificados.' };
  }

  const concentration: PortfolioConcentration[] = [];
  let stackScore = 0;       // accumulates how much it piles onto heavy factors
  let novelFactors = 0;     // factors the portfolio lacks

  for (const f of candidateFactors) {
    const weight = ctx.factorWeights[f] ?? 0;
    if (weight === 0) { novelFactors++; continue; }
    const corr = avgCorrelationToFactor(candidateReturns, f, ctx);
    concentration.push({ factor: f, portfolioWeight: weight, avgCorrelation: corr });
    if (weight >= FACTOR_THRESHOLD) {
      // severity grows with weight; correlation amplifies (default 1 if unknown).
      const corrMult = Number.isNaN(corr) ? 1 : Math.max(0, corr) / STACK_CORR;
      stackScore += weight * Math.min(corrMult, 1.5);
    }
  }

  let rawDelta = 0;
  let verdict: PortfolioAdjustment['verdict'] = 'neutral';
  let reason = 'Relación neutral con la cartera.';

  if (stackScore > 0) {
    rawDelta = -Math.min(MAX_RAW_DELTA, Math.round(stackScore * MAX_RAW_DELTA));
    verdict = 'stacks';
    const top = concentration
      .filter(c => c.portfolioWeight >= FACTOR_THRESHOLD)
      .sort((a, b) => b.portfolioWeight - a.portfolioWeight)[0];
    const corrTxt = top && !Number.isNaN(top.avgCorrelation) ? `, corr ${top.avgCorrelation.toFixed(2)}` : '';
    const syms = (top ? ctx.factorSymbols[top.factor] ?? [] : []).join('/');
    reason = `Apila riesgo ${top?.factor} (ya ${Math.round((top?.portfolioWeight ?? 0) * 100)}% en ${syms}${corrTxt}).`;
  } else if (novelFactors === candidateFactors.length) {
    // entirely new factors → diversifier
    rawDelta = Math.min(6, novelFactors * 3);
    verdict = 'diversifies';
    reason = `Diversifica: aporta factores que la cartera no tiene (${candidateFactors.join(', ')}).`;
  } else if (novelFactors > 0) {
    rawDelta = 3;
    verdict = 'diversifies';
    reason = `Parcialmente diversificador: suma ${novelFactors} factor(es) nuevo(s).`;
  }

  const delta = Math.round(rawDelta * clampedIntensity) + 0; // +0 normalizes -0 → 0
  return { delta, rawDelta, intensity: clampedIntensity, concentration, verdict, reason };
}

export function buildPortfolioDiagnostic(
  ctx: PortfolioContext,
  candidateVerdicts: Array<{ symbol: string; verdict: 'stacks' | 'diversifies' | 'neutral' }>,
): PortfolioDiagnostic {
  if (ctx.totalValue === 0) {
    return { factorExposure: [], concentrationFlags: [], missingHedges: [], diversifiers: [], stackers: [] };
  }
  const factorExposure = (Object.keys(ctx.factorWeights) as RiskFactor[])
    .map(f => ({ factor: f, weight: ctx.factorWeights[f] ?? 0, symbols: ctx.factorSymbols[f] ?? [] }))
    .sort((a, b) => b.weight - a.weight);

  const concentrationFlags = factorExposure
    .filter(f => f.weight >= FACTOR_THRESHOLD)
    .map(f => `${Math.round(f.weight * 100)}% en ${f.factor} (${f.symbols.join('/')}) — alta concentración.`);

  const hedgeWeight = HEDGE_FACTORS.reduce((s, f) => s + (ctx.factorWeights[f] ?? 0), 0);
  const diversifiers = candidateVerdicts.filter(c => c.verdict === 'diversifies').map(c => c.symbol);
  const stackers = candidateVerdicts.filter(c => c.verdict === 'stacks').map(c => c.symbol);

  // Missing-hedge: the book is concentrated in a risk factor yet carries essentially
  // no hedge (safe-haven / rates / gold) — nothing rises when risk-on falls.
  const missingHedges: MissingHedge[] = [];
  if (concentrationFlags.length > 0 && hedgeWeight < 0.1) {
    const topFactor = factorExposure[0];
    for (const h of HEDGE_FACTORS) {
      if ((ctx.factorWeights[h] ?? 0) > 0) continue;
      missingHedges.push({
        hedge: h,
        reason: `Cartera concentrada (${Math.round(topFactor.weight * 100)}% en ${topFactor.factor}) sin cobertura ${h}: si cae el apetito de riesgo, nada sube.`,
        candidates: diversifiers,
      });
    }
  }
  return { factorExposure, concentrationFlags, missingHedges, diversifiers, stackers };
}
