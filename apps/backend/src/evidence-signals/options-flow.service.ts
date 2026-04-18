import type { OptionsExpiryData } from '../shared/yahoo.js';
import type { OptionsFlowSignal } from '@trading/shared';

const MAX_EXPIRY_DAYS = 45;
const MIN_CP_RATIO = 2.0;
const OTM_THRESHOLD = 1.02;   // calls must be ≥2% above current price
const MIN_VOI_RATIO = 0.25;   // volume/openInterest — fresh positioning (not just existing contracts)
const MIN_UNUSUAL_VOLUME = 300;  // minimum unusual OTM call volume to care about

/**
 * Options flow signal based on UNUSUAL OTM call activity.
 *
 * What changed vs naive call/put ratio:
 * - Only counts OTM calls (directional bets, not hedges)
 * - Requires V/OI > 0.25 (fresh buying, not just existing OI sitting there)
 * - This eliminates the constant false positives on mega-caps where raw call
 *   volume always outweighs puts due to retail perpetual bullishness.
 *
 * @param currentPrice Pass 0 when price is unknown — returns no signal safely.
 */
export function computeOptionsFlowSignal(
  optionsData: OptionsExpiryData[],
  currentPrice: number,
): OptionsFlowSignal {
  const noSignal: OptionsFlowSignal = {
    active: false, callVolume: 0, putVolume: 0, callPutRatio: 0,
    nearestExpiry: null, dominantSentiment: 'neutral', score: 0, unusualStrikes: 0,
  };

  if (!optionsData.length || currentPrice <= 0) return noSignal;

  const now = new Date();
  const maxExpiry = new Date(now.getTime() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const relevant = optionsData.filter((opt) => {
    if (!opt.expirationDate) return false;
    const expiry = new Date(opt.expirationDate);
    return expiry >= now && expiry <= maxExpiry;
  });

  if (!relevant.length) return noSignal;

  const nearestExpiry = relevant[0].expirationDate;
  const otmStrike = currentPrice * OTM_THRESHOLD;

  let unusualCallVolume = 0;
  let unusualStrikes = 0;
  let totalCallVolume = 0;
  let totalPutVolume = 0;

  for (const expiry of relevant) {
    for (const call of expiry.calls) {
      const vol = call.volume ?? 0;
      totalCallVolume += vol;

      const isOTM = call.strike > otmStrike;
      const oi = call.openInterest ?? 0;
      // Fresh positioning: meaningfully traded relative to existing interest
      const isUnusual = vol > 0 && oi > 0 && vol / oi >= MIN_VOI_RATIO;

      if (isOTM && isUnusual) {
        unusualCallVolume += vol;
        unusualStrikes++;
      }
    }
    for (const put of expiry.puts) {
      totalPutVolume += put.volume ?? 0;
    }
  }

  const ratio = totalPutVolume > 0 ? totalCallVolume / totalPutVolume : totalCallVolume > 0 ? totalCallVolume : 0;

  if (unusualCallVolume < MIN_UNUSUAL_VOLUME || ratio < MIN_CP_RATIO) {
    return {
      active: false,
      callVolume: unusualCallVolume,
      putVolume: totalPutVolume,
      callPutRatio: Math.round(ratio * 100) / 100,
      nearestExpiry,
      dominantSentiment: 'neutral',
      score: 0,
      unusualStrikes,
    };
  }

  let score = 0;
  if (ratio >= 5.0 && unusualCallVolume >= 2000) score = 90;
  else if (ratio >= 5.0 || unusualCallVolume >= 2000) score = 80;
  else if (ratio >= 3.0 || unusualCallVolume >= 800) score = 65;
  else score = 50;

  // Many concentrated unusual strikes = more directional conviction
  if (unusualStrikes >= 5) score = Math.min(100, score + 5);

  return {
    active: true,
    callVolume: unusualCallVolume,
    putVolume: totalPutVolume,
    callPutRatio: Math.round(ratio * 100) / 100,
    nearestExpiry,
    dominantSentiment: 'bullish',
    score,
    unusualStrikes,
  };
}
