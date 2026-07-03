import { db } from '../db/index.js';
import { signalTracking, scoringWeightProposals, scoringWeightHistory } from '../db/schema.js';
import { eq, gte, and, desc } from 'drizzle-orm';

export interface ScoringWeights {
  shortTerm: { technical: number; fundamental: number; sentiment: number };
  mediumTerm: { technical: number; fundamental: number; sentiment: number };
}

// Pesos por evidencia empírica (relevamiento 2026-07-03, n=565 señales resueltas):
// tech r=+0.24 (única señal real), sentiment r=+0.03 (ruido, p≈0.47), fund r=-0.07 (sin señal).
// El sentiment queda simbólico (0.05) hasta que weight proposals con datos limpios demuestren edge.
export const DEFAULT_WEIGHTS: ScoringWeights = {
  shortTerm: { technical: 0.70, sentiment: 0.05, fundamental: 0.25 },
  mediumTerm: { technical: 0.50, sentiment: 0.05, fundamental: 0.45 },
};

let _cachedWeights: ScoringWeights | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function getActiveWeights(): ScoringWeights {
  if (_cachedWeights && Date.now() < _cacheExpiry) return _cachedWeights;
  const latest = db.select().from(scoringWeightHistory).orderBy(desc(scoringWeightHistory.appliedAt)).limit(1).get();
  if (latest) {
    _cachedWeights = JSON.parse(latest.weights) as ScoringWeights;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return _cachedWeights;
  }
  _cachedWeights = DEFAULT_WEIGHTS;
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return _cachedWeights;
}

export function invalidateWeightsCache(): void {
  _cachedWeights = null;
  _cacheExpiry = 0;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0);
  const denX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0));
  const denY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0));
  if (denX === 0 || denY === 0) return 0;
  return num / (denX * denY);
}

function normalizeWeights(raw: { technical: number; fundamental: number; sentiment: number }, minEach = 0.10) {
  const t = Math.max(raw.technical, minEach);
  const f = Math.max(raw.fundamental, minEach);
  const s = Math.max(raw.sentiment, minEach);
  const total = t + f + s;
  const techRounded = Math.round((t / total) * 100) / 100;
  const fundRounded = Math.round((f / total) * 100) / 100;
  return {
    technical: techRounded,
    fundamental: fundRounded,
    sentiment: Math.round((1 - techRounded - fundRounded) * 100) / 100,
  };
}

const MIN_SIGNALS = 20;

export function shouldGenerateProposal(): boolean {
  const pending = db.select().from(scoringWeightProposals).where(eq(scoringWeightProposals.status, 'pending')).get();
  if (pending) return false;

  const lastApproved = db.select().from(scoringWeightProposals)
    .where(eq(scoringWeightProposals.status, 'approved'))
    .orderBy(desc(scoringWeightProposals.approvedAt))
    .limit(1).get();

  const since = lastApproved?.approvedAt ?? '2000-01-01';
  const allResolved = db.select().from(signalTracking)
    .where(gte(signalTracking.resolvedAt, since))
    .all()
    .filter(s => s.outcome && s.outcome !== 'pending' && s.outcome !== 'invalid');

  return allResolved.length >= MIN_SIGNALS;
}

export function generateWeightProposal(): { id: number } | null {
  if (!shouldGenerateProposal()) return null;

  const signals = db.select().from(signalTracking).all()
    .filter(s => s.outcome && s.outcome !== 'pending' && s.outcome !== 'invalid' && s.techScore != null && s.fundScore != null && s.sentScore != null);

  if (signals.length < MIN_SIGNALS) return null;

  // 'invalid' ya está excluido de `signals` arriba — lo que llega acá es win/loss/neutral.
  const outcomeVal = (o: string | null) => o === 'win' ? 1 : o === 'loss' ? 0 : 0.5;

  const stSignals = signals.filter(s => s.shortTermScore != null);
  const mtSignals = signals;

  const stOutcomes = stSignals.map(s => outcomeVal(s.outcome));
  const mtOutcomes = mtSignals.map(s => outcomeVal(s.outcome));

  const stCorr = {
    technical: pearson(stSignals.map(s => s.techScore!), stOutcomes),
    fundamental: pearson(stSignals.map(s => s.fundScore!), stOutcomes),
    sentiment: pearson(stSignals.map(s => s.sentScore!), stOutcomes),
  };
  const mtCorr = {
    technical: pearson(mtSignals.map(s => s.techScore!), mtOutcomes),
    fundamental: pearson(mtSignals.map(s => s.fundScore!), mtOutcomes),
    sentiment: pearson(mtSignals.map(s => s.sentScore!), mtOutcomes),
  };

  const proposedWeights: ScoringWeights = {
    shortTerm: normalizeWeights(stCorr),
    mediumTerm: normalizeWeights(mtCorr),
  };

  const currentWeights = getActiveWeights();

  const result = db.insert(scoringWeightProposals).values({
    signalCount: signals.length,
    shortTermBasis: stSignals.length,
    mediumTermBasis: mtSignals.length,
    currentWeights: JSON.stringify(currentWeights),
    proposedWeights: JSON.stringify(proposedWeights),
    correlations: JSON.stringify({ shortTerm: stCorr, mediumTerm: mtCorr }),
    status: 'pending',
  }).returning().get();

  console.log(`[weight-adjustment] Generated proposal #${result.id} based on ${signals.length} signals`);
  return { id: result.id };
}

export function approveWeightProposal(id: number): void {
  const proposal = db.select().from(scoringWeightProposals).where(eq(scoringWeightProposals.id, id)).get();
  if (!proposal || proposal.status !== 'pending') throw new Error('Propuesta no encontrada o ya procesada');

  const now = new Date().toISOString();
  db.update(scoringWeightProposals).set({ status: 'approved', approvedAt: now, appliedAt: now }).where(eq(scoringWeightProposals.id, id)).run();
  db.insert(scoringWeightHistory).values({ weights: proposal.proposedWeights, source: 'proposal', proposalId: id, accuracyBefore: null }).run();
  invalidateWeightsCache();
  console.log(`[weight-adjustment] Proposal #${id} approved and applied`);
}

export function rejectWeightProposal(id: number, reason?: string): void {
  const proposal = db.select().from(scoringWeightProposals).where(eq(scoringWeightProposals.id, id)).get();
  if (!proposal || proposal.status !== 'pending') throw new Error('Propuesta no encontrada o ya procesada');
  db.update(scoringWeightProposals).set({ status: 'rejected', rejectedReason: reason ?? null }).where(eq(scoringWeightProposals.id, id)).run();
  console.log(`[weight-adjustment] Proposal #${id} rejected`);
}

export function getPendingProposal() {
  const row = db.select().from(scoringWeightProposals)
    .where(eq(scoringWeightProposals.status, 'pending'))
    .orderBy(desc(scoringWeightProposals.proposedAt))
    .limit(1).get();
  if (!row) return null;
  return {
    ...row,
    currentWeights: JSON.parse(row.currentWeights) as ScoringWeights,
    proposedWeights: JSON.parse(row.proposedWeights) as ScoringWeights,
    correlations: JSON.parse(row.correlations) as { shortTerm: { technical: number; fundamental: number; sentiment: number }; mediumTerm: { technical: number; fundamental: number; sentiment: number } },
  };
}

export function getWeightHistory() {
  return db.select().from(scoringWeightHistory)
    .orderBy(desc(scoringWeightHistory.appliedAt))
    .limit(20).all()
    .map(row => ({ ...row, weights: JSON.parse(row.weights) as ScoringWeights }));
}
