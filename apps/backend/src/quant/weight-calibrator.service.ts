/**
 * Calibración de pesos por eje.
 *
 * ⚠️ ESTE OUTPUT NO GOBIERNA EL SCORING. Escribe en `calibrated_weights`; el scoring lee de
 * `scoring_weight_history` vía `getActiveWeights` (intelligence/weight-adjustment.service.ts),
 * que solo se puebla con propuestas APROBADAS por el dueño. Nada consume
 * `getLatestCalibratedWeights` — verificado 2026-07-27. Es un artefacto de observación.
 *
 * ⚠️ MÉTODO CORREGIDO 2026-07-27. La versión anterior medía "accuracy direccional": qué
 * fracción de las veces el SIGNO del eje coincidía con el signo de `returnAfter30d`. Dos
 * fallas graves:
 *   1. Objetivo equivocado: `returnAfter30d` no es un retorno a 30 días sino el retorno de
 *      RESOLUCIÓN (corta en stop/target), y se comparaba contra CERO en vez de contra el índice.
 *   2. La métrica está dominada por la BASE RATE, no por información. Solo el 41.4% de las
 *      señales le gana al índice, así que un predictor constante que dijera siempre "negativo"
 *      sacaría 58.6% de accuracy — más que los tres ejes reales (48.8 / 54.0 / 53.3). El
 *      calibrador estaba repartiendo pesos proporcionales a números sin contenido.
 * Ahora usa `axisCorrelationsVsBenchmark`: correlación de cada eje contra el alpha sobre el
 * índice. Es libre de base rate, está testeada, y es la MISMA base que usa el path de
 * propuestas — un solo método, no dos divergentes.
 */
import { db } from '../db/index.js';
import { signalTracking } from '../db/schema.js';
import { and, isNotNull, gte, sql } from 'drizzle-orm';
import type { CalibratedWeights } from '@trading/shared';
import { SHORT_TERM_WEIGHTS, MEDIUM_TERM_WEIGHTS } from '../opportunities/scoring.js';
import { axisCorrelationsVsBenchmark } from '../intelligence/weight-adjustment.service.js';
import { saveLatestCalibratedWeights, getLatestCalibratedWeights } from './backtest.repository.js';

const MIN_RECORDS = 30;
const LOOKBACK_DAYS = 90;
const SMOOTHING = 0.3;

export function calibrateWeights(): CalibratedWeights | null {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const records = db.select({
    techScore: signalTracking.techScore,
    fundScore: signalTracking.fundScore,
    sentScore: signalTracking.sentScore,
    alphaVsBenchmark: signalTracking.alphaVsBenchmark,
  }).from(signalTracking)
    .where(and(
      sql`${signalTracking.outcome} != 'pending'`,
      isNotNull(signalTracking.outcome),
      isNotNull(signalTracking.alphaVsBenchmark),
      gte(signalTracking.signalDate, cutoffStr),
    ))
    .all();

  const corr = axisCorrelationsVsBenchmark(records, MIN_RECORDS);
  if (corr == null) return null;

  // Correlaciones negativas no pueden pesar negativo: se pisan en 0 y el piso de
  // normalización (abajo) les deja el mínimo. Un eje que anticorrelaciona con el alpha
  // no merece peso, pero tampoco se lo invierte sin evidencia de que la inversión pague.
  const techAcc = Math.max(0, corr.technical);
  const fundAcc = Math.max(0, corr.fundamental);
  const sentAcc = Math.max(0, corr.sentiment);
  const sum = techAcc + fundAcc + sentAcc || 1;

  const blend = (calc: number, base: number) =>
    Math.round(((1 - SMOOTHING) * (calc / sum) + SMOOTHING * base) * 100) / 100;

  const stTech = blend(techAcc, SHORT_TERM_WEIGHTS.technical);
  const stFund = blend(fundAcc, SHORT_TERM_WEIGHTS.fundamental);
  const stSent = blend(sentAcc, SHORT_TERM_WEIGHTS.sentiment);
  const stSum = stTech + stFund + stSent || 1;

  const mtTech = blend(techAcc, MEDIUM_TERM_WEIGHTS.technical);
  const mtFund = blend(fundAcc, MEDIUM_TERM_WEIGHTS.fundamental);
  const mtSent = blend(sentAcc, MEDIUM_TERM_WEIGHTS.sentiment);
  const mtSum = mtTech + mtFund + mtSent || 1;

  const result: CalibratedWeights = {
    shortTerm: {
      technical: Math.round(stTech / stSum * 100) / 100,
      fundamental: Math.round(stFund / stSum * 100) / 100,
      sentiment: Math.round(stSent / stSum * 100) / 100,
    },
    mediumTerm: {
      technical: Math.round(mtTech / mtSum * 100) / 100,
      fundamental: Math.round(mtFund / mtSum * 100) / 100,
      sentiment: Math.round(mtSent / mtSum * 100) / 100,
    },
    calibratedAt: new Date().toISOString(),
    basedOnDays: LOOKBACK_DAYS,
    signalAccuracies: {
      technical: Math.round(techAcc * 100) / 100,
      fundamental: Math.round(fundAcc * 100) / 100,
      sentiment: Math.round(sentAcc * 100) / 100,
    },
  };

  saveLatestCalibratedWeights(result);
  return result;
}

export { getLatestCalibratedWeights };
