import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { getAllSymbols } from '../db/repository.js';
import { getEarningsHistory, getInsiderTransactions, getOptionsChain } from '../shared/yahoo.js';
import { computePEADSignal } from './pead.service.js';
import { computeInsiderSignal } from './insider.service.js';
import { computeOptionsFlowSignal } from './options-flow.service.js';
import type { EvidenceSignal, EvidenceScanResult } from '@trading/shared';
import { getQuote } from '../shared/yahoo.js';

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

function buildReasoning(signal: EvidenceSignal): string {
  const parts: string[] = [];

  if (signal.pead.active) {
    parts.push(`Earnings beat ${signal.pead.beatPercent.toFixed(1)}% hace ${signal.pead.daysSinceEarnings} días — aún en ventana de drift (${signal.pead.daysInDriftWindow}d restantes)`);
  }
  if (signal.insider.active) {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
    parts.push(`${signal.insider.numberOfBuyers} insider(s) compraron ${fmt.format(signal.insider.totalValue)} — última compra: ${signal.insider.mostRecentBuyDate}`);
  }
  if (signal.optionsFlow.active) {
    parts.push(`Call/Put ratio ${signal.optionsFlow.callPutRatio}x con ${signal.optionsFlow.callVolume.toLocaleString()} contratos call`);
  }

  if (!parts.length) return 'Sin señales activas en este momento';
  return parts.join(' | ');
}

async function computeEvidenceSignal(symbol: string): Promise<EvidenceSignal> {
  const cached = getCachedSignal(symbol);
  if (cached) return cached;

  const [earningsHistory, insiderTransactions, optionsData, quoteResult] = await Promise.allSettled([
    getEarningsHistory(symbol),
    getInsiderTransactions(symbol),
    getOptionsChain(symbol),
    getQuote(symbol),
  ]);

  const pead = computePEADSignal(
    earningsHistory.status === 'fulfilled' ? earningsHistory.value : []
  );
  const insider = computeInsiderSignal(
    insiderTransactions.status === 'fulfilled' ? insiderTransactions.value : []
  );
  const optionsFlow = computeOptionsFlowSignal(
    optionsData.status === 'fulfilled' ? optionsData.value : []
  );

  const activeCount = [pead.active, insider.active, optionsFlow.active].filter(Boolean).length;
  const activeScores = [
    pead.active ? pead.score : null,
    insider.active ? insider.score : null,
    optionsFlow.active ? optionsFlow.score : null,
  ].filter((s): s is number => s !== null);

  const compositeScore = activeScores.length
    ? Math.round(activeScores.reduce((a, b) => a + b, 0) / activeScores.length)
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
    currentPrice: quoteResult.status === 'fulfilled' ? quoteResult.value.current : undefined,
  };

  signal.reasoning = buildReasoning(signal);

  setCachedSignal(symbol, signal);
  return signal;
}

const CONCURRENCY = 5;

export async function getAllEvidenceSignals(forceRefresh = false): Promise<EvidenceScanResult> {
  if (forceRefresh) {
    db.delete(schema.evidenceSignalsCache).run();
  }

  const symbols = getAllSymbols()
    .filter((s) => s.type === 'us' || s.type === 'adr')
    .map((s) => s.symbol);

  const signals: EvidenceSignal[] = [];

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((s) => computeEvidenceSignal(s)));
    for (const r of results) {
      if (r.status === 'fulfilled') signals.push(r.value);
    }
  }

  signals.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    scannedAt: new Date().toISOString(),
    totalSymbols: signals.length,
    highConviction: signals.filter((s) => s.conviction === 'high').length,
    mediumConviction: signals.filter((s) => s.conviction === 'medium').length,
    signals,
  };
}

export async function getEvidenceSignalForSymbol(symbol: string): Promise<EvidenceSignal> {
  return computeEvidenceSignal(symbol);
}

export function invalidateEvidenceCache(): void {
  db.delete(schema.evidenceSignalsCache).run();
}
