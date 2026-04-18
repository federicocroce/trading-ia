import type { OptionsExpiryData } from '../shared/yahoo.js';
import type { OptionsFlowSignal } from '@trading/shared';

const MIN_CALL_VOLUME = 500;
const MIN_CP_RATIO = 2.0;
const MAX_EXPIRY_DAYS = 45;

export function computeOptionsFlowSignal(optionsData: OptionsExpiryData[]): OptionsFlowSignal {
  const noSignal: OptionsFlowSignal = {
    active: false, callVolume: 0, putVolume: 0, callPutRatio: 0,
    nearestExpiry: null, dominantSentiment: 'neutral', score: 0,
  };

  if (!optionsData.length) return noSignal;

  const now = new Date();
  const maxExpiry = new Date();
  maxExpiry.setDate(maxExpiry.getDate() + MAX_EXPIRY_DAYS);

  // Filter to expiries within 45 days
  const relevant = optionsData.filter((opt) => {
    if (!opt.expirationDate) return false;
    const expiry = new Date(opt.expirationDate);
    return expiry >= now && expiry <= maxExpiry;
  });

  if (!relevant.length) return noSignal;

  // Aggregate call + put volume across relevant expiries
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  const nearestExpiry = relevant[0].expirationDate;

  for (const expiry of relevant) {
    totalCallVolume += expiry.calls.reduce((s, c) => s + (c.volume ?? 0), 0);
    totalPutVolume += expiry.puts.reduce((s, p) => s + (p.volume ?? 0), 0);
  }

  if (totalCallVolume < MIN_CALL_VOLUME && totalPutVolume < MIN_CALL_VOLUME) return noSignal;

  const ratio = totalPutVolume > 0 ? totalCallVolume / totalPutVolume : totalCallVolume;
  const dominantSentiment: OptionsFlowSignal['dominantSentiment'] =
    ratio >= 2.0 ? 'bullish' : ratio <= 0.5 ? 'bearish' : 'neutral';

  // Only flag unusual CALL activity (bullish bias for swing trading)
  if (totalCallVolume < MIN_CALL_VOLUME || ratio < MIN_CP_RATIO) {
    return {
      active: false, callVolume: totalCallVolume, putVolume: totalPutVolume,
      callPutRatio: Math.round(ratio * 100) / 100,
      nearestExpiry, dominantSentiment: 'neutral', score: 0,
    };
  }

  let score = 0;
  if (ratio >= 5.0 && totalCallVolume >= 5_000) score = 90;
  else if (ratio >= 5.0 || totalCallVolume >= 5_000) score = 80;
  else if (ratio >= 3.0 || totalCallVolume >= 1_000) score = 65;
  else score = 50;

  return {
    active: true,
    callVolume: totalCallVolume,
    putVolume: totalPutVolume,
    callPutRatio: Math.round(ratio * 100) / 100,
    nearestExpiry,
    dominantSentiment,
    score,
  };
}
