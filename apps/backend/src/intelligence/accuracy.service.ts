import { db } from '../db/index.js';
import { signalTracking, missedOpportunities } from '../db/schema.js';
import { gte, sql } from 'drizzle-orm';

export interface AccuracyReport {
  summary: {
    totalSignals: number;
    resolvedSignals: number;
    pendingSignals: number;
    winRate: number;
    avgPredictedReturn: number;
    avgActualReturn: number;
    predictionBias: number;
    mae: number;
  };
  byAction: Record<string, {
    total: number;
    resolved: number;
    winRate: number;
    avgReturn: number;
  }>;
  bySector: Array<{
    sector: string;
    total: number;
    winRate: number;
    avgReturn: number;
  }>;
  byConfidenceTier: Record<string, {
    label: string;
    total: number;
    winRate: number;
    avgReturn: number;
  }>;
  entryAccuracy: { hitRate: number; avgDeviation: number };
  targetAccuracy: { hitRate: number; avgDeviation: number };
  stopAccuracy: { triggerRate: number; avgDeviation: number };
  trend: {
    rolling30d: number | null;
    rolling60d: number | null;
    rolling90d: number | null;
  };
  missedOpps: {
    total: number;
    avgMissedReturn: number;
    topMissed: Array<{
      symbol: string;
      date: string;
      return7d: number | null;
      return30d: number | null;
      wouldHaveBeen: string | null;
    }>;
  };
}

function calcWinRate(signals: Array<{ outcome: string | null }>): number {
  const resolved = signals.filter(s => s.outcome && s.outcome !== 'pending');
  if (resolved.length === 0) return 0;
  return Math.round((resolved.filter(s => s.outcome === 'win').length / resolved.length) * 100);
}

function calcAvg(values: (number | null | undefined)[]): number {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return 0;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

export function getAccuracyReport(days: 30 | 60 | 90 | 180 = 90): AccuracyReport {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const signals = db.select().from(signalTracking)
    .where(gte(signalTracking.signalDate, sinceStr))
    .all();

  const resolved = signals.filter(s => s.outcome && s.outcome !== 'pending');

  // Summary
  const predVsActual = resolved
    .filter(s => s.predictedReturnMid != null && (s.returnAfter30d ?? s.returnAfter7d) != null)
    .map(s => ({ pred: s.predictedReturnMid!, actual: (s.returnAfter30d ?? s.returnAfter7d)! }));

  const mae = calcAvg(predVsActual.map(p => Math.abs(p.pred - p.actual)));
  const bias = calcAvg(predVsActual.map(p => p.pred - p.actual));

  // By action
  const byAction: AccuracyReport['byAction'] = {};
  for (const action of ['BUY', 'SELL', 'HOLD', 'WATCH']) {
    const group = signals.filter(s => s.action === action);
    byAction[action] = {
      total: group.length,
      resolved: group.filter(s => s.outcome && s.outcome !== 'pending').length,
      winRate: calcWinRate(group),
      avgReturn: calcAvg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    };
  }

  // By sector
  const sectorMap = new Map<string, typeof signals>();
  for (const s of signals) {
    const key = s.sector ?? 'Unknown';
    if (!sectorMap.has(key)) sectorMap.set(key, []);
    sectorMap.get(key)!.push(s);
  }
  const bySector = Array.from(sectorMap.entries())
    .map(([sector, group]) => ({
      sector,
      total: group.length,
      winRate: calcWinRate(group),
      avgReturn: calcAvg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    }))
    .sort((a, b) => b.total - a.total);

  // By confidence tier
  const tierGroups: Record<string, typeof signals> = { low: [], medium: [], high: [], vhigh: [] };
  for (const s of signals) {
    const c = s.confidence;
    if (c >= 85) tierGroups.vhigh.push(s);
    else if (c >= 70) tierGroups.high.push(s);
    else if (c >= 55) tierGroups.medium.push(s);
    else tierGroups.low.push(s);
  }
  const tierLabels: Record<string, string> = { low: '40–55%', medium: '55–70%', high: '70–85%', vhigh: '85%+' };
  const byConfidenceTier: AccuracyReport['byConfidenceTier'] = {};
  for (const key of ['low', 'medium', 'high', 'vhigh'] as const) {
    const group = tierGroups[key];
    byConfidenceTier[key] = {
      label: tierLabels[key],
      total: group.length,
      winRate: calcWinRate(group),
      avgReturn: calcAvg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    };
  }

  // Entry/target/stop accuracy
  const withTarget = resolved.filter(s => s.targetPrice != null);
  const withStop = resolved.filter(s => s.stopLoss != null);

  const rollingSince = (d: number): number | null => {
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    const str = dt.toISOString().split('T')[0];
    const group = resolved.filter(s => s.signalDate >= str);
    return group.length >= 3 ? calcWinRate(group) : null;
  };

  // Missed opportunities
  const missedTotal = db.select({ count: sql<number>`count(*)` })
    .from(missedOpportunities)
    .where(gte(missedOpportunities.scanDate, sinceStr))
    .get()?.count ?? 0;

  const missed = db.select().from(missedOpportunities)
    .where(gte(missedOpportunities.scanDate, sinceStr))
    .orderBy(sql`COALESCE(actual_return_30d, actual_return_7d) DESC`)
    .limit(10)
    .all();

  return {
    summary: {
      totalSignals: signals.length,
      resolvedSignals: resolved.length,
      pendingSignals: signals.filter(s => !s.outcome || s.outcome === 'pending').length,
      winRate: calcWinRate(resolved),
      avgPredictedReturn: calcAvg(signals.map(s => s.predictedReturnMid)),
      avgActualReturn: calcAvg(resolved.map(s => s.returnAfter30d ?? s.returnAfter7d)),
      predictionBias: bias,
      mae,
    },
    byAction,
    bySector,
    byConfidenceTier,
    entryAccuracy: {
      hitRate: resolved.length > 0 ? Math.round((resolved.filter(s => s.entryHit).length / resolved.length) * 100) : 0,
      avgDeviation: calcAvg(resolved.map(s => s.entryDeviation)),
    },
    targetAccuracy: {
      hitRate: withTarget.length > 0 ? Math.round((withTarget.filter(s => s.hitTarget).length / withTarget.length) * 100) : 0,
      avgDeviation: calcAvg(withTarget.map(s => s.targetDeviation)),
    },
    stopAccuracy: {
      triggerRate: withStop.length > 0 ? Math.round((withStop.filter(s => s.hitStop).length / withStop.length) * 100) : 0,
      avgDeviation: calcAvg(withStop.map(s => s.stopDeviation)),
    },
    trend: {
      rolling30d: rollingSince(30),
      rolling60d: rollingSince(60),
      rolling90d: rollingSince(90),
    },
    missedOpps: {
      total: missedTotal,
      avgMissedReturn: calcAvg(missed.map(m => m.actualReturn30d ?? m.actualReturn7d)),
      topMissed: missed.map(m => ({
        symbol: m.symbol,
        date: m.scanDate,
        return7d: m.actualReturn7d,
        return30d: m.actualReturn30d,
        wouldHaveBeen: m.wouldHaveBeen,
      })),
    },
  };
}
