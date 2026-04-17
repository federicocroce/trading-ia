import { db } from '../db/index.js';
import { signalTracking } from '../db/schema.js';
import { and, isNotNull, gte, sql } from 'drizzle-orm';
import type { CalibratedWeights } from '@trading/shared';
import { SHORT_TERM_WEIGHTS, MEDIUM_TERM_WEIGHTS } from '../opportunities/scoring.js';
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
    returnAfter30d: signalTracking.returnAfter30d,
  }).from(signalTracking)
    .where(and(
      sql`${signalTracking.outcome} != 'pending'`,
      isNotNull(signalTracking.outcome),
      isNotNull(signalTracking.returnAfter30d),
      gte(signalTracking.signalDate, cutoffStr),
    ))
    .all();

  if (records.length < MIN_RECORDS) return null;

  let techCorrect = 0, fundCorrect = 0, sentCorrect = 0, total = 0;

  for (const r of records) {
    if (r.techScore == null || r.fundScore == null || r.sentScore == null || r.returnAfter30d == null) continue;
    const actualPositive = r.returnAfter30d > 0;
    if ((r.techScore > 0) === actualPositive) techCorrect++;
    if ((r.fundScore > 0) === actualPositive) fundCorrect++;
    if ((r.sentScore > 0) === actualPositive) sentCorrect++;
    total++;
  }

  if (total < MIN_RECORDS) return null;

  const techAcc = techCorrect / total;
  const fundAcc = fundCorrect / total;
  const sentAcc = sentCorrect / total;
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
