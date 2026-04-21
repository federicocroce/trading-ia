import { db, schema } from '../db/index.js';
import { gte, eq, desc } from 'drizzle-orm';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getSectorRotation } from '../macro/sector-rotation.service.js';
import { getCachedAnalysis } from '../evidence-signals/deep-analysis.service.js';
import type {
  WeeklyPick, SectorRotationData, SectorCategory, WeeklyPickTier,
  EvidenceSignal, Opportunity,
} from '@trading/shared';
import type { EvidenceMarketRegime } from '@trading/shared';

const MIN_SCORE = 70;

// ─── Pure functions (exported for testing) ────────────────────────────────────

export function assignTier(
  signal: EvidenceSignal,
  opportunityScore: number,
  weeklyUp: boolean,
  sectorCategory: SectorCategory,
  regime: EvidenceMarketRegime,
): WeeklyPickTier | null {
  if (regime === 'bear') return null;
  if (opportunityScore < MIN_SCORE) return null;

  if (signal.regimeAdjustedConviction === 'high') {
    if (weeklyUp && sectorCategory !== 'LAGGING') return 'HIGH';
    return 'MEDIUM';
  }

  if (signal.regimeAdjustedConviction === 'medium') {
    if (sectorCategory === 'LAGGING') return null;
    return 'MEDIUM';
  }

  return null;
}

export function getEvidenceType(signal: EvidenceSignal): WeeklyPick['evidence']['type'] {
  if (signal.pead.active && signal.insider.active) return 'PEAD_INSIDER';
  if (signal.pead.active) return 'PEAD';
  if (signal.insider.active) return 'INSIDER';
  if (signal.optionsFlow.active) return 'OPTIONS';
  return 'FUNDAMENTAL';
}

export function buildEvidenceDetail(signal: EvidenceSignal): string {
  const parts: string[] = [];
  if (signal.pead.active) {
    parts.push(`Earnings beat ${signal.pead.beatPercent.toFixed(0)}%`);
    if (signal.pead.consecutiveBeats > 1) parts.push(`${signal.pead.consecutiveBeats}Q consecutive`);
  }
  if (signal.insider.active) {
    const val = (signal.insider.totalValue / 1_000_000).toFixed(1);
    parts.push(`${signal.insider.numberOfBuyers} insider${signal.insider.numberOfBuyers > 1 ? 's' : ''} $${val}M`);
  }
  if (signal.optionsFlow.active && signal.optionsFlow.unusualStrikes > 0) {
    parts.push(`${signal.optionsFlow.unusualStrikes} unusual call strikes`);
  }
  return parts.join(' + ') || 'Multiple signals aligned';
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getActiveCachedSignals(): EvidenceSignal[] {
  const now = new Date().toISOString();
  const rows = db.select()
    .from(schema.evidenceSignalsCache)
    .where(gte(schema.evidenceSignalsCache.expiresAt, now))
    .all();
  return rows
    .map((row) => {
      try { return JSON.parse(row.data) as EvidenceSignal; } catch { return null; }
    })
    .filter(Boolean) as EvidenceSignal[];
}

function getLatestOpportunity(symbol: string): Opportunity | null {
  const row = db.select({ data: schema.opportunitySnapshots.data })
    .from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.symbol, symbol))
    .orderBy(desc(schema.opportunitySnapshots.scannedAt))
    .limit(1)
    .get();
  if (!row) return null;
  try { return JSON.parse(row.data) as Opportunity; } catch { return null; }
}

function getSectorCategoryForOpp(
  sectorData: SectorRotationData[],
  opp: Opportunity,
): SectorCategory {
  const sectorEtfMap: Record<string, string> = {
    'us-tech': 'XLK',
    'us-energy': 'XLE',
    'argentina-energy': 'XLE',
    'argentina-finance': 'XLF',
    'argentina-cedears': 'XLY',
    'commodities': 'XLB',
  };
  const etf = sectorEtfMap[opp.sector];
  if (!etf) return 'NEUTRAL';
  return sectorData.find((s) => s.etf === etf)?.category ?? 'NEUTRAL';
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function generateWeeklyPicks(): Promise<WeeklyPick[]> {
  const [regime, sectorRotation] = await Promise.all([
    getMarketRegime(),
    getSectorRotation(),
  ]);

  const signals = getActiveCachedSignals().filter(
    (s) => s.regimeAdjustedConviction === 'high' || s.regimeAdjustedConviction === 'medium',
  );

  const picks: WeeklyPick[] = [];

  for (const signal of signals) {
    const opp = getLatestOpportunity(signal.symbol);
    if (!opp?.breakdown || !opp.tradeLevels) continue;

    const fundamentalScore = opp.breakdown.fundamental?.score ?? 0;
    const technicalScore = opp.breakdown.technical?.score ?? 0;
    const weeklyUp = opp.weekly?.trend === 'up';
    const sectorCategory = getSectorCategoryForOpp(sectorRotation, opp);
    const deepAnalysis = getCachedAnalysis(signal.symbol);

    if (deepAnalysis?.verdict === 'PASS') continue;

    const tier = assignTier(signal, fundamentalScore, weeklyUp, sectorCategory, regime.regime);
    if (!tier) continue;

    const levels = opp.tradeLevels;
    if (!levels.stopLoss || !levels.takeProfit) continue;

    picks.push({
      symbol: signal.symbol,
      tier,
      evidence: {
        type: getEvidenceType(signal),
        detail: buildEvidenceDetail(signal),
      },
      entryLow: Math.round(levels.entryPrice * 0.99 * 100) / 100,
      entryHigh: Math.round(levels.entryPrice * 1.01 * 100) / 100,
      stop: levels.stopLoss,
      target: levels.takeProfit,
      rrRatio: levels.riskRewardRatio,
      regime: regime.regime,
      sectorCategory,
      aiVerdict: deepAnalysis?.verdict,
      fundamentalScore,
      technicalScore,
      scanDate: new Date().toISOString().split('T')[0],
      historicalWinRate: null,
    });
  }

  picks.sort((a, b) => {
    if (a.tier === 'HIGH' && b.tier !== 'HIGH') return -1;
    if (a.tier !== 'HIGH' && b.tier === 'HIGH') return 1;
    return b.fundamentalScore - a.fundamentalScore;
  });

  return picks.slice(0, 5);
}

export async function saveWeeklyPicks(picks: WeeklyPick[]): Promise<void> {
  for (const pick of picks) {
    db.insert(schema.weeklyPicks).values({
      scanDate: pick.scanDate,
      symbol: pick.symbol,
      tier: pick.tier,
      evidenceType: pick.evidence.type,
      evidenceDetail: pick.evidence.detail,
      entryLow: pick.entryLow,
      entryHigh: pick.entryHigh,
      stop: pick.stop,
      target: pick.target,
      rrRatio: pick.rrRatio,
      regime: pick.regime,
      sectorCategory: pick.sectorCategory,
      aiVerdict: pick.aiVerdict,
      fundamentalScore: pick.fundamentalScore,
      technicalScore: pick.technicalScore,
    }).run();
  }
}

export function getLatestWeeklyPicks(): WeeklyPick[] {
  const latestDate = db.select({ scanDate: schema.weeklyPicks.scanDate })
    .from(schema.weeklyPicks)
    .orderBy(desc(schema.weeklyPicks.scanDate))
    .limit(1)
    .get()?.scanDate;
  if (!latestDate) return [];

  return db.select()
    .from(schema.weeklyPicks)
    .where(eq(schema.weeklyPicks.scanDate, latestDate))
    .all()
    .map((row) => ({
      symbol: row.symbol,
      tier: row.tier as WeeklyPickTier,
      evidence: { type: row.evidenceType as WeeklyPick['evidence']['type'], detail: row.evidenceDetail },
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      stop: row.stop,
      target: row.target,
      rrRatio: row.rrRatio,
      regime: row.regime as EvidenceMarketRegime,
      sectorCategory: row.sectorCategory as SectorCategory,
      aiVerdict: row.aiVerdict as WeeklyPick['aiVerdict'],
      fundamentalScore: row.fundamentalScore,
      technicalScore: row.technicalScore,
      scanDate: row.scanDate,
      historicalWinRate: null,
    }));
}
