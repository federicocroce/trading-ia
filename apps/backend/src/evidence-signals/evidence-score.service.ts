import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { EvidenceSignal, EvidenceConviction } from '@trading/shared';

export interface EvidenceScoreResult {
  /** Score normalizado a -100..+100 (consistente con techScore/fundScore). 0 = sin datos o neutro. */
  score: number;
  /** Drivers humanos para mostrar en UI. */
  drivers: string[];
  /** True si hay datos vigentes para el símbolo. */
  hasData: boolean;
  /** Conviction original ('high' | 'medium' | 'low' | 'none'). */
  conviction: EvidenceConviction;
  /** activeSignals count del signal original. */
  activeSignals: number;
}

const EMPTY_RESULT: EvidenceScoreResult = {
  score: 0,
  drivers: [],
  hasData: false,
  conviction: 'none',
  activeSignals: 0,
};

/**
 * Lee el evidence signal cacheado para un símbolo y lo destila a:
 *  - score: -100..+100 (alineado con la escala de techScore/fundScore para combinar en composite)
 *  - drivers: razones cortas humanas listas para UI
 *
 * Reglas de normalización:
 *  - compositeScore viene en 0..100 (es magnitud, no dirección).
 *  - Por defecto se asume bullish (PEAD positivo, insider buying, unusual calls).
 *  - Si optionsFlow domina BEARISH y está activo → score se invierte a negativo.
 *  - Map 0..100 → -50..+70 (conservador: no llega a los extremos para que no domine el composite).
 *  - Si !hasData → score = 0 (no penaliza ni premia; queda neutro).
 */
export function getEvidenceScore(symbol: string): EvidenceScoreResult {
  let row: typeof schema.evidenceSignalsCache.$inferSelect | undefined;
  try {
    row = db.select()
      .from(schema.evidenceSignalsCache)
      .where(eq(schema.evidenceSignalsCache.symbol, symbol))
      .get();
  } catch {
    return EMPTY_RESULT;
  }

  if (!row || new Date(row.expiresAt) < new Date()) {
    return EMPTY_RESULT;
  }

  let signal: EvidenceSignal;
  try {
    signal = JSON.parse(row.data) as EvidenceSignal;
  } catch {
    return EMPTY_RESULT;
  }

  const drivers: string[] = [];

  if (signal.pead.active) {
    const beat = signal.pead.beatPercent.toFixed(1);
    const days = signal.pead.daysSinceEarnings;
    const confirmed = signal.pead.priceConfirmed ? ' (precio confirmado)' : '';
    const streak = signal.pead.consecutiveBeats > 1 ? `, ${signal.pead.consecutiveBeats}Q seguidos` : '';
    drivers.push(`PEAD activo: beat ${beat}% día ${days} de drift${confirmed}${streak}`);
  }

  if (signal.insider.active) {
    const valueK = Math.round(signal.insider.totalValue / 1000);
    const valueStr = valueK >= 1000 ? `$${(valueK / 1000).toFixed(1)}M` : `$${valueK}k`;
    drivers.push(`Insider buying: ${valueStr} de ${signal.insider.numberOfBuyers} buyer(s)`);
  }

  if (signal.optionsFlow.active) {
    const dir = signal.optionsFlow.dominantSentiment;
    const ratio = signal.optionsFlow.callPutRatio.toFixed(2);
    const strikes = signal.optionsFlow.unusualStrikes;
    const dirLabel = dir === 'bullish' ? '🟢 calls' : dir === 'bearish' ? '🔴 puts' : '⚪ mixto';
    drivers.push(`Options flow ${dirLabel}: C/P ${ratio} (${strikes} strikes inusuales)`);
  }

  if (signal.sectorTrend) {
    const t = signal.sectorTrend;
    const dirEmoji = t.trend === 'outperforming' ? '🟢' : t.trend === 'underperforming' ? '🔴' : '⚪';
    drivers.push(`Sector ${t.etf} ${dirEmoji}: ${t.priceVsSma50Pct >= 0 ? '+' : ''}${t.priceVsSma50Pct.toFixed(1)}% vs SMA50`);
  }

  const base = signal.compositeScore; // 0..100

  let normalized: number;
  if (signal.optionsFlow.active && signal.optionsFlow.dominantSentiment === 'bearish') {
    // Bearish options dominantes → score invertido
    normalized = -base;
  } else if (base === 0) {
    normalized = 0;
  } else {
    // Map 0..100 → -50..+70 (conservador, no toca extremos para no dominar al composite)
    normalized = base - 30;
    if (normalized < -50) normalized = -50;
    if (normalized > 70) normalized = 70;
  }

  // Bear regime: penalizar hasta un 30%
  if (signal.regimeAdjustedConviction !== signal.conviction && normalized > 0) {
    normalized = Math.round(normalized * 0.7);
  }

  return {
    score: Math.round(normalized),
    drivers,
    hasData: true,
    conviction: signal.conviction,
    activeSignals: signal.activeSignals,
  };
}

/** Batch helper para evitar N queries — útil cuando se procesan muchos símbolos. */
export function getEvidenceScoreMap(symbols: string[]): Map<string, EvidenceScoreResult> {
  const map = new Map<string, EvidenceScoreResult>();
  for (const symbol of symbols) {
    map.set(symbol, getEvidenceScore(symbol));
  }
  return map;
}
