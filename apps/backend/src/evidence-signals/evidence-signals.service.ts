import { db, schema } from '../db/index.js';
import { eq, and, gte } from 'drizzle-orm';
import { getAllSymbols, insertSignalTracking } from '../db/repository.js';
import { getEarningsHistory, getInsiderTransactions, getOptionsChain, getQuote, getHistoricalQuotes, getFundamentals } from '../shared/yahoo.js';
import { computePEADSignal } from './pead.service.js';
import { computeInsiderSignal } from './insider.service.js';
import { computeOptionsFlowSignal } from './options-flow.service.js';
import type { EvidenceSignal, EvidenceScanResult } from '@trading/shared';
import { getScreenedSymbols, invalidateScreenerCache, getPeadOverrides, CURATED_ETF_SYMBOLS, type PeadOverride } from './symbol-screener.service.js';
import { triggerDeepAnalysis, getAnalysisStatus, invalidateDeepAnalysisCache } from './deep-analysis.service.js';
import { triggerSignalResolver } from './signal-resolver.service.js';
import { getMarketRegime, invalidateMarketRegimeCache } from './market-regime.service.js';
import { getSectorMomentum } from './sector-momentum.service.js';
import type { MarketRegimeData } from '@trading/shared';

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
  // Targets calibrated for 3-6 month hold timeframe
  const { pead, insider, optionsFlow, conviction } = signal;
  if (conviction === 'high') return { targetPct: 0.30, stopPct: -0.10 };
  // Medium: pick dominant signal combination
  if (pead.active && insider.active) return { targetPct: 0.25, stopPct: -0.09 };
  if (pead.active && optionsFlow.active) return { targetPct: 0.20, stopPct: -0.09 };
  if (insider.active && optionsFlow.active) return { targetPct: 0.20, stopPct: -0.08 };
  // Single signal fallbacks
  if (pead.active) return { targetPct: 0.18, stopPct: -0.08 };
  if (insider.active) return { targetPct: 0.15, stopPct: -0.07 };
  return { targetPct: 0.12, stopPct: -0.06 };
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
      // Evidence V2 component scores for future analysis
      peadScore: signal.pead.active ? signal.pead.score : null,
      insiderScore: signal.insider.active ? signal.insider.score : null,
      optionsScore: signal.optionsFlow.active ? signal.optionsFlow.score : null,
      activeSignalsCount: signal.activeSignals,
      marketRegimeAtSignal: lastMarketRegime?.regime ?? null,
      beatPercent: signal.pead.active ? signal.pead.beatPercent : null,
      consecutiveBeats: signal.pead.active ? signal.pead.consecutiveBeats : null,
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

  const [earningsHistory, insiderTransactions, optionsData, quoteResult, ohlcHistory, fundamentalsResult] = await Promise.allSettled([
    getEarningsHistory(symbol),
    getInsiderTransactions(symbol),
    getOptionsChain(symbol),
    getQuote(symbol),
    getHistoricalQuotes(symbol, '3mo', '1d'),
    getFundamentals(symbol),
  ]);

  const currentPrice = quoteResult.status === 'fulfilled' ? quoteResult.value.current : 0;

  // ETFs have no earnings beats or insider buying — skip those signals to avoid noise
  const isEtf = CURATED_ETF_SYMBOLS.includes(symbol);
  const pead = isEtf ? { active: false, beatPercent: 0, daysSinceEarnings: 0, daysInDriftWindow: 0, score: 0, epsActual: null, epsEstimate: null, earningsDate: null, priceConfirmed: false, priceChangePct: null, consecutiveBeats: 0 } : computePEADSignal(
    earningsHistory.status === 'fulfilled' ? earningsHistory.value : [],
    ohlcHistory.status === 'fulfilled' ? ohlcHistory.value : [],
    peadOverride,
  );
  const insider = isEtf ? { active: false, recentBuys: [], totalValue: 0, numberOfBuyers: 0, mostRecentBuyDate: null, score: 0 } : computeInsiderSignal(
    insiderTransactions.status === 'fulfilled' ? insiderTransactions.value : []
  );
  const optionsFlow = computeOptionsFlowSignal(
    optionsData.status === 'fulfilled' ? optionsData.value : [],
    currentPrice,
  );

  // Hard prerequisite: bear regime blocks all LONG signals (SPY < SMA200)
  // ETFs are exempt since they can serve as hedges / sector shorts context
  const regime = lastMarketRegime?.regime ?? 'neutral';
  const bearBlock = !isEtf && regime === 'bear';
  const peadActive = bearBlock ? false : pead.active;
  const insiderActive = bearBlock ? false : insider.active;
  const optionsActive = optionsFlow.active;

  const activeCount = [peadActive, insiderActive, optionsActive].filter(Boolean).length;

  // Options flow is a short-term signal (0-45d expiry). For 3-6m holds, weight it less
  // than PEAD (quality filter) and Insider (3-6m visibility into fundamentals).
  const weightedScores: Array<{ score: number; weight: number }> = [
    peadActive ? { score: pead.score, weight: 1.0 } : null,
    insiderActive ? { score: insider.score, weight: 1.0 } : null,
    optionsActive ? { score: optionsFlow.score, weight: 0.5 } : null,
  ].filter((s): s is { score: number; weight: number } => s !== null);

  const totalWeight = weightedScores.reduce((a, b) => a + b.weight, 0);
  const weightedSum = weightedScores.reduce((a, b) => a + b.score * b.weight, 0);

  // Conviction multiplier: lone signals are less reliable than corroborated ones
  const convictionMultiplier = activeCount >= 3 ? 1.0 : activeCount === 2 ? 0.9 : 0.7;

  // Fundamentals quality multiplier (skip for ETFs which have no earnings)
  const fundamentals = !isEtf && fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : null;
  let fundamentalsMultiplier = 1.0;
  let fundamentalsNote = '';
  if (fundamentals && activeCount > 0) {
    const revGrowth = fundamentals.revenueGrowth;
    const opMargin = fundamentals.operatingMargin;
    if (revGrowth != null && opMargin != null) {
      if (revGrowth < -10 && opMargin < -15) {
        fundamentalsMultiplier = 0.6; // revenue shrinking + deeply unprofitable
        fundamentalsNote = `⚠️ Fundamentos débiles: revenue ${revGrowth.toFixed(1)}% YoY, margen op. ${opMargin.toFixed(1)}%`;
      } else if (revGrowth < -5 || opMargin < -20) {
        fundamentalsMultiplier = 0.8; // one bad metric
        fundamentalsNote = `⚠️ Fundamentos: revenue ${revGrowth.toFixed(1)}% YoY, margen op. ${opMargin.toFixed(1)}%`;
      } else if (revGrowth > 15 && opMargin > 10) {
        fundamentalsMultiplier = 1.1; // strong growth + profitable
        fundamentalsNote = `✓ Fundamentos sólidos: revenue +${revGrowth.toFixed(1)}% YoY, margen op. ${opMargin.toFixed(1)}%`;
      }
    }
  }

  const compositeScore = weightedScores.length
    ? Math.min(100, Math.round((weightedSum / totalWeight) * convictionMultiplier * fundamentalsMultiplier))
    : 0;

  const conviction: EvidenceSignal['conviction'] =
    activeCount >= 3 ? 'high'
    : activeCount === 2 ? 'medium'
    : activeCount === 1 ? 'low'
    : 'none';

  // Downgrade conviction when market is in bear regime: high→medium, medium→low
  const regimeAdjustedConviction: EvidenceSignal['conviction'] =
    regime === 'bear' && conviction === 'high' ? 'medium'
    : regime === 'bear' && conviction === 'medium' ? 'low'
    : conviction;

  const recommendation: EvidenceSignal['recommendation'] =
    activeCount >= 2 ? 'WATCH_CLOSELY'
    : activeCount === 1 ? 'INTERESTING'
    : 'NO_SIGNAL';

  // Fetch sector trend (cached per ETF, cheap)
  const sectorData = await getSectorMomentum(symbol).catch(() => null);
  const sectorTrend = sectorData ? {
    etf: sectorData.sectorEtf,
    name: sectorData.sectorName,
    trend: sectorData.trend,
    priceVsSma50Pct: sectorData.priceVsSma50Pct,
  } : undefined;

  const signal: EvidenceSignal = {
    symbol,
    scannedAt: new Date().toISOString(),
    conviction,
    regimeAdjustedConviction,
    activeSignals: activeCount,
    pead: { ...pead, active: peadActive },
    insider: { ...insider, active: insiderActive },
    optionsFlow,
    compositeScore,
    recommendation,
    reasoning: '',
    currentPrice: currentPrice > 0 ? currentPrice : undefined,
    sectorTrend,
  };

  signal.reasoning = buildReasoning(signal) + (fundamentalsNote ? ` | ${fundamentalsNote}` : '');

  setCachedSignal(symbol, signal);
  autoTrackSignal(signal);
  return signal;
}

const CONCURRENCY = 5;

let scanState: 'idle' | 'scanning' = 'idle';
let lastScanAt: string | null = null;
let scannedCount = 0;
let totalCount = 0;
let lastMarketRegime: MarketRegimeData | undefined;

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
    marketRegime: lastMarketRegime,
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
      invalidateMarketRegimeCache();
    }

    // Fetch market regime first — used to context-weight signals
    lastMarketRegime = await getMarketRegime();
    if (lastMarketRegime.regime === 'bear') {
      console.warn(`[EvidenceSignals] ⚠️  BEAR MARKET: SPY ${lastMarketRegime.priceVsSma200Pct}% bajo SMA200. Señales LONG son de ALTO RIESGO.`);
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

    // Auto-resolve pending signal outcomes (non-blocking)
    triggerSignalResolver();
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
