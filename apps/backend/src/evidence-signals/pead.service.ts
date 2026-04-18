import type { EarningsHistoryEntry } from '../shared/yahoo.js';
import type { PEADSignal } from '@trading/shared';

const DRIFT_WINDOW_DAYS = 60;
const MIN_BEAT_PERCENT = 10;

export function computePEADSignal(history: EarningsHistoryEntry[]): PEADSignal {
  const noSignal: PEADSignal = {
    active: false, beatPercent: 0, daysSinceEarnings: 0,
    daysInDriftWindow: 0, score: 0, epsActual: null, epsEstimate: null, earningsDate: null,
  };

  if (!history.length) return noSignal;

  // Sort by most recent quarter first
  const sorted = [...history].sort((a, b) => {
    if (!a.quarter || !b.quarter) return 0;
    return new Date(b.quarter).getTime() - new Date(a.quarter).getTime();
  });

  const latest = sorted[0];
  if (!latest.quarter || latest.surprisePercent == null) return noSignal;

  const earningsDate = new Date(latest.quarter);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - earningsDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSince > DRIFT_WINDOW_DAYS) return noSignal;
  if (latest.surprisePercent < MIN_BEAT_PERCENT) return noSignal;

  const beat = latest.surprisePercent;
  let score = 0;
  if (beat >= 40) score = 95;
  else if (beat >= 25) score = 85;
  else if (beat >= 15) score = 70;
  else score = 55;

  return {
    active: true,
    beatPercent: Math.round(beat * 100) / 100,
    daysSinceEarnings: daysSince,
    daysInDriftWindow: DRIFT_WINDOW_DAYS - daysSince,
    score,
    epsActual: latest.epsActual,
    epsEstimate: latest.epsEstimate,
    earningsDate: latest.quarter,
  };
}
