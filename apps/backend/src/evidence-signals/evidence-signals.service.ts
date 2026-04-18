import { db, schema } from '../db/index.js';
import { eq, and, gte } from 'drizzle-orm';
import { getAllSymbols, insertSignalTracking } from '../db/repository.js';
import { getEarningsHistory, getInsiderTransactions, getOptionsChain, getQuote, getHistoricalQuotes } from '../shared/yahoo.js';
import { computePEADSignal } from './pead.service.js';
import { computeInsiderSignal } from './insider.service.js';
import { computeOptionsFlowSignal } from './options-flow.service.js';
import type { EvidenceSignal, EvidenceScanResult } from '@trading/shared';
import { getScreenedSymbols, invalidateScreenerCache, getPeadOverrides, type PeadOverride } from './symbol-screener.service.js';
import { triggerDeepAnalysis, getAnalysisStatus, invalidateDeepAnalysisCache } from './deep-analysis.service.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getCachedSignal(symbol: string): EvidenceSignal | null {
  const row = db.select()
    .from(schema.evidenceSignalsCache)
    .where(eq(schema.evidenceSignalsCache.symbol, symbol))
    .get();

  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  try {
    return JSON.parse(row.data) as EvidenceSignal;
  } catch {
    return null;
  }
}

function setCachedSignal(symbol: string, signal: EvidenceSignal): void {
  const now = new Date();
  const expires = new Date(now.getTime() + CACHE_TTL_MS);
  db.insert(schema.evidenceSignalsCache)
    .values({
      symbol,
      data: JSON.stringify(signal),
      fetchedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.evidenceSignalsCache.symbol,
      set: {
        data: JSON.stringify(signal),
        fetchedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
      },
    })
    .run();
}

const TRACKING_DEDUP_DAYS = 14;

function hasRecentTracking(symbol: string): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TRACKING_DEDUP_DAYS);
  const row = db.select({ id: schema.signalTracking.id })
    .from(schema.signalTracking)
    .where(and(
      eq(schema.signalTracking.symbol, symbol),
      eq(schema.signalTracking.outcome, 'pending'),
      gte(schema.signalTracking.signalDate, cutoff.toISOString().split('T')[0]),
    ))
    .get();
  return !!row;
}

function calcTargetsForSignal(signal: EvidenceSignal): { targetPct: number; stopPct: number } {
  const { pead, insider, optionsFlow, conviction } = signal;
  if (conviction === 'high') return { targetPct: 0.20, stopPct: -0.08 };
  // Medium: pick dominant signal for targets
  if (pead.active && insider.active) return { targetPct: 0.18, stopPct: -0.07 };
  if (pead.active && optionsFlow.active) return { targetPct: 0.15, stopPct: -0.07 };
  if (insider.active && optionsFlow.active) return { targetPct: 0.15, stopPct: -0.06 };
  // Single signal fallbacks (shouldn't reach here for tracking, but safety)
  if (pead.active) return { targetPct: 0.15, stopPct: -0.07 };
  if (insider.active) return { targetPct: 0.10, stopPct: -0.05 };
  return { targetPct: 0.08, stopPct: -0.05 };
}

function autoTrackSignal(signal: EvidenceSignal): void {
  if (signal.conviction !== 'high' && signal.conviction !== 'medium') return;
  if (!signal.currentPrice || signal.currentPrice <= 0) return;
  if (hasRecentTracking(signal.symbol)) return;

  const { targetPct, stopPct } = calcTargetsForSignal(signal);
  const entry = signal.currentPrice;

  try {
    insertSignalTracking({
      symbol: signal.symbol,
      signalDate: new Date().toISOString().split('T')[0],
      action: 'BUY',
      entryPrice: entry,
      targetPrice: Math.round(entry * (1 + targetPct) * 100) / 100,
      stopLoss: Math.round(entry * (1 + stopPct) * 100) / 100,
      confidence: signal.conviction === 'high' ? 90 : 70,
      opportunityScore: signal.compositeScore,
      sector: 'evidence-v2',
      predictedReturnMid: targetPct * 100,
    });
    console.log(`[EvidenceSignals] Auto-tracked ${signal.symbol} (${signal.conviction} conviction, score ${signal.compositeScore})`);
  } catch (err) {
    console.warn(`[EvidenceSignals] Failed to auto-track ${signal.symbol}:`, (err as Error).message);
  }
}

function buildReasoning(signal: EvidenceSignal): string {
  const parts: string[] = [];

  if (signal.pead.active) {
    const priceInfo = signal.pead.priceChangePct != null
      ? ` · precio confirmó +${signal.pead.priceChangePct.toFixed(1)}% post-earnings`
      : '';
    parts.push(`Earnings beat ${signal.pead.beatPercent.toFixed(1)}% hace ${signal.pead.daysSinceEarnings}d${priceInfo} · drift restante: ${signal.pead.daysInDriftWindow}d`);
  }
  if (signal.insider.active) {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
    parts.push(`${signal.insider.numberOfBuyers} insider(s) compraron ${fmt.format(signal.insider.totalValue)} — última: ${signal.insider.mostRecentBuyDate}`);
  }
  if (signal.optionsFlow.active) {
    parts.push(`${signal.optionsFlow.unusualStrikes} strikes OTM con actividad inusual · C/P ${signal.optionsFlow.callPutRatio}x · ${signal.optionsFlow.callVolume.toLocaleString()} contratos`);
  }

  if (!parts.length) return 'Sin señales activas en este momento';
  return parts.join(' | ');
}

async function computeEvidenceSignal(symbol: string, peadOverride?: PeadOverride): Promise<EvidenceSignal> {
  const cached = getCachedSignal(symbol);
  if (cached) return cached;

  const [earningsHistory, insiderTransactions, optionsData, quoteResult, ohlcHistory] = await Promise.allSettled([
    getEarningsHistory(symbol),
    getInsiderTransactions(symbol),
    getOptionsChain(symbol),
    getQuote(symbol),
    getHistoricalQuotes(symbol, '3mo', '1d'),
  ]);

  const currentPrice = quoteResult.status === 'fulfilled' ? quoteResult.value.current : 0;

  const pead = computePEADSignal(
    earningsHistory.status === 'fulfilled' ? earningsHistory.value : [],
    ohlcHistory.status === 'fulfilled' ? ohlcHistory.value : [],
    peadOverride,
  );
  const insider = computeInsiderSignal(
    insiderTransactions.status === 'fulfilled' ? insiderTransactions.value : []
  );
  const optionsFlow = computeOptionsFlowSignal(
    optionsData.status === 'fulfilled' ? optionsData.value : [],
    currentPrice,
  );

  const activeCount = [pead.active, insider.active, optionsFlow.active].filter(Boolean).length;
  const activeScores = [
    pead.active ? pead.score : null,
    insider.active ? insider.score : null,
    optionsFlow.active ? optionsFlow.score : null,
  ].filter((s): s is number => s !== null);

  // Conviction multiplier: lone signals are less reliable than corroborated ones
  const convictionMultiplier = activeCount >= 3 ? 1.0 : activeCount === 2 ? 0.9 : 0.7;
  const compositeScore = activeScores.length
    ? Math.round(activeScores.reduce((a, b) => a + b, 0) / activeScores.length * convictionMultiplier)
    : 0;

  const conviction: EvidenceSignal['conviction'] =
    activeCount >= 3 ? 'high'
    : activeCount === 2 ? 'medium'
    : activeCount === 1 ? 'low'
    : 'none';

  const recommendation: EvidenceSignal['recommendation'] =
    activeCount >= 2 ? 'WATCH_CLOSELY'
    : activeCount === 1 ? 'INTERESTING'
    : 'NO_SIGNAL';

  const signal: EvidenceSignal = {
    symbol,
    scannedAt: new Date().toISOString(),
    conviction,
    activeSignals: activeCount,
    pead,
    insider,
    optionsFlow,
    compositeScore,
    recommendation,
    reasoning: '',
    currentPrice: currentPrice > 0 ? currentPrice : undefined,
  };

  signal.reasoning = buildReasoning(signal);

  setCachedSignal(symbol, signal);
  autoTrackSignal(signal);
  return signal;
}

const CONCURRENCY = 5;

let scanState: 'idle' | 'scanning' = 'idle';
let lastScanAt: string | null = null;
let scannedCount = 0;
let totalCount = 0;

export function getScanStatus() {
  const analysis = getAnalysisStatus();
  return {
    state: scanState,
    lastScanAt,
    scannedCount,
    totalCount,
    analysisState: analysis.analysisState,
    analyzedCount: analysis.analyzedCount,
    analysisTotal: analysis.analysisTotal,
  };
}

function readAllFromCache(): EvidenceScanResult {
  const rows = db.select().from(schema.evidenceSignalsCache).all();
  const signals: EvidenceSignal[] = rows
    .filter((r) => new Date(r.expiresAt) > new Date())
    .map((r) => JSON.parse(r.data) as EvidenceSignal)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    scannedAt: lastScanAt ?? new Date().toISOString(),
    totalSymbols: signals.length,
    highConviction: signals.filter((s) => s.conviction === 'high').length,
    mediumConviction: signals.filter((s) => s.conviction === 'medium').length,
    signals,
  };
}

async function runScan(forceRefresh: boolean) {
  if (scanState === 'scanning') return;
  scanState = 'scanning';

  try {
    if (forceRefresh) {
      db.delete(schema.evidenceSignalsCache).run();
      invalidateScreenerCache();
      invalidateDeepAnalysisCache();
    }

    const portfolioSymbols = getAllSymbols()
      .filter((s) => s.type === 'us' || s.type === 'adr')
      .map((s) => s.symbol);

    const { symbols, peadOverrides } = await getScreenedSymbols(portfolioSymbols);

    totalCount = symbols.length;
    scannedCount = 0;
    console.log(`[EvidenceSignals] Escaneando ${symbols.length} símbolos: ${symbols.join(', ')}`);

    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      console.log(`[EvidenceSignals] Batch ${Math.floor(i / CONCURRENCY) + 1}: ${batch.join(', ')}`);
      const results = await Promise.allSettled(
        batch.map((s) => computeEvidenceSignal(s, peadOverrides.get(s)))
      );
      for (const r of results) {
        scannedCount++;
        if (r.status === 'fulfilled') {
          const s = r.value;
          if (s.activeSignals > 0) {
            console.log(`[EvidenceSignals] ✓ ${s.symbol} — ${s.conviction}, score: ${s.compositeScore}, señales: ${[s.pead.active && 'PEAD', s.insider.active && 'INSIDER', s.optionsFlow.active && 'OPTIONS'].filter(Boolean).join('+')}`);
          }
        } else {
          console.warn(`[EvidenceSignals] ✗ Error:`, r.reason?.message);
        }
      }
    }

    lastScanAt = new Date().toISOString();
    const cached = readAllFromCache();
    const withSignals = cached.signals.filter((s) => s.activeSignals > 0);
    console.log(`[EvidenceSignals] Scan completo — ${withSignals.length}/${cached.totalSymbols} con señales activas`);

    // Fire deep analysis for HIGH/MEDIUM conviction signals (non-blocking)
    triggerDeepAnalysis(withSignals);
  } finally {
    scanState = 'idle';
  }
}

export function getCachedScanResult(): EvidenceScanResult {
  return readAllFromCache();
}

export function triggerScan(forceRefresh = false): void {
  // Fire and forget — non-blocking
  runScan(forceRefresh).catch((err) =>
    console.error('[EvidenceSignals] Scan error:', err)
  );
}

export async function getEvidenceSignalForSymbol(symbol: string): Promise<EvidenceSignal> {
  return computeEvidenceSignal(symbol, getPeadOverrides().get(symbol));
}

export function invalidateEvidenceCache(): void {
  db.delete(schema.evidenceSignalsCache).run();
}
