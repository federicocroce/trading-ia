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

export function pearson(xs: number[], ys: number[]): number {
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

const MIN_SIGNALS = 20;

/** Fila mínima que necesita la calibración: los tres ejes y el exceso sobre el índice. */
export interface AxisSample {
  techScore: number | null;
  fundScore: number | null;
  sentScore: number | null;
  alphaVsBenchmark: number | null;
}

/**
 * Correlación de cada eje contra el ALPHA (exceso sobre el índice) en la ventana de la señal.
 *
 * ⚠️ CAMBIO 2026-07-27 — antes esto correlacionaba contra `outcome` (win=1 / loss=0), que se
 * define contra el propio stop/target del sistema, o sea contra CERO. Con ese objetivo un eje
 * que seleccionaba señales de +0.5% en ventanas donde el índice hizo +2% salía premiado por
 * destruir valor. Los pesos que salgan de acá gobiernan el score (vía propuesta aprobada →
 * scoring_weight_history → getActiveWeights), así que el objetivo tiene que ser el correcto.
 *
 * Fail-closed: una fila sin alguno de los ejes, o sin alpha (benchmark sin cobertura en esa
 * ventana), se DESCARTA. Jamás se imputa 0 — un 0 imputado es "el eje no dijo nada / el
 * índice no se movió", dos afirmaciones falsas que sesgarían la correlación hacia el ruido.
 *
 * Devuelve null si no quedan al menos `minRows` filas medibles: sin base no se proponen pesos.
 */
export function axisCorrelationsVsBenchmark(
  rows: AxisSample[],
  minRows = MIN_SIGNALS,
): { technical: number; fundamental: number; sentiment: number } | null {
  const usable = rows.filter(
    (r) => r.techScore != null && r.fundScore != null && r.sentScore != null && r.alphaVsBenchmark != null,
  );
  if (usable.length < minRows) return null;
  const alpha = usable.map((r) => r.alphaVsBenchmark!);
  return {
    technical: pearson(usable.map((r) => r.techScore!), alpha),
    fundamental: pearson(usable.map((r) => r.fundScore!), alpha),
    sentiment: pearson(usable.map((r) => r.sentScore!), alpha),
  };
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

  // Objetivo = ALPHA sobre el índice, no win/loss (que se mide contra cero). Ver
  // axisCorrelationsVsBenchmark. Fail-closed: sin filas medibles no se propone nada.
  const mtSignals = signals;
  const stSignals = signals.filter(s => s.shortTermScore != null);

  const stCorr = axisCorrelationsVsBenchmark(stSignals);
  const mtCorr = axisCorrelationsVsBenchmark(mtSignals);
  if (stCorr == null || mtCorr == null) {
    console.log('[weight-adjustment] Sin suficientes señales con alpha medido — no se propone nada');
    return null;
  }

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
