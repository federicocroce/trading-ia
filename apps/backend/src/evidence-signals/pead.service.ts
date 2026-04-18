import type { EarningsHistoryEntry } from '../shared/yahoo.js';
import type { OHLC, PEADSignal } from '@trading/shared';
import type { PeadOverride } from './symbol-screener.service.js';

const DRIFT_WINDOW_DAYS = 60;
const MIN_BEAT_PERCENT = 10;
const MIN_PRICE_MOVE_PCT = 1.5; // must close ≥+1.5% within 5 trading days of earnings

function scoreFromBeat(beat: number): number {
  if (beat >= 40) return 95;
  if (beat >= 25) return 85;
  if (beat >= 15) return 70;
  return 55;
}

/**
 * Validates that price actually moved up post-earnings.
 * This catches "beat EPS but sold off on guidance cut" cases — those are NOT PEAD candidates.
 *
 * Returns confirmed=true when ohlcHistory is empty (data unavailable) to avoid false negatives.
 */
function validatePriceDirection(
  announcementDate: string,
  ohlcHistory: OHLC[],
): { confirmed: boolean; changePct: number | null } {
  if (!ohlcHistory.length) return { confirmed: true, changePct: null };

  const announcementTs = new Date(announcementDate).getTime();

  const preEarnings = ohlcHistory
    .filter((c) => new Date(c.date).getTime() < announcementTs)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  if (!preEarnings) return { confirmed: true, changePct: null };

  // Max close within 5 trading days after announcement (7 calendar days covers weekends)
  const postWindow = ohlcHistory
    .filter((c) => {
      const ts = new Date(c.date).getTime();
      return ts >= announcementTs && ts <= announcementTs + 7 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 5);

  if (!postWindow.length) return { confirmed: true, changePct: null };

  const maxPostClose = Math.max(...postWindow.map((c) => c.close));
  const changePct = Math.round(((maxPostClose - preEarnings.close) / preEarnings.close) * 10000) / 100;

  return { confirmed: changePct >= MIN_PRICE_MOVE_PCT, changePct };
}

/**
 * Computes the PEAD (Post-Earnings Announcement Drift) signal.
 *
 * nasdaqOverride (primary): uses Wall Street consensus EPS beat data from NASDAQ API.
 * Yahoo Finance fallback: used when NASDAQ data is unavailable; less accurate.
 *
 * Both paths now validate price direction post-earnings to filter out false positives
 * where the stock beat EPS but sold off on the day (guidance cuts, etc.).
 */
export function computePEADSignal(
  history: EarningsHistoryEntry[],
  ohlcHistory: OHLC[],
  nasdaqOverride?: PeadOverride,
): PEADSignal {
  const noSignal: PEADSignal = {
    active: false, beatPercent: 0, daysSinceEarnings: 0,
    daysInDriftWindow: 0, score: 0, epsActual: null, epsEstimate: null,
    earningsDate: null, priceConfirmed: false, priceChangePct: null,
  };

  // ── NASDAQ path (authoritative) ────────────────────────────────────────────
  if (nasdaqOverride) {
    const { announcementDate, surprisePct } = nasdaqOverride;
    if (surprisePct < MIN_BEAT_PERCENT) return noSignal;

    const daysSince = Math.floor((Date.now() - new Date(announcementDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > DRIFT_WINDOW_DAYS || daysSince < 0) return noSignal;

    const { confirmed: priceConfirmed, changePct: priceChangePct } = validatePriceDirection(
      announcementDate,
      ohlcHistory,
    );

    if (!priceConfirmed) {
      return {
        active: false,
        beatPercent: Math.round(surprisePct * 100) / 100,
        daysSinceEarnings: daysSince,
        daysInDriftWindow: DRIFT_WINDOW_DAYS - daysSince,
        score: 0,
        epsActual: null, epsEstimate: null,
        earningsDate: announcementDate,
        priceConfirmed: false,
        priceChangePct,
      };
    }

    let score = scoreFromBeat(surprisePct);
    if (priceChangePct != null && priceChangePct >= 5) score = Math.min(100, score + 5);

    return {
      active: true,
      beatPercent: Math.round(surprisePct * 100) / 100,
      daysSinceEarnings: daysSince,
      daysInDriftWindow: DRIFT_WINDOW_DAYS - daysSince,
      score,
      epsActual: null, epsEstimate: null,
      earningsDate: announcementDate,
      priceConfirmed,
      priceChangePct,
    };
  }

  // ── Yahoo Finance fallback ─────────────────────────────────────────────────
  if (!history.length) return noSignal;

  const sorted = [...history].sort((a, b) => {
    if (!a.quarter || !b.quarter) return 0;
    return new Date(b.quarter).getTime() - new Date(a.quarter).getTime();
  });

  const latest = sorted[0];
  if (!latest.quarter || latest.surprisePercent == null) return noSignal;

  const daysSince = Math.floor((Date.now() - new Date(latest.quarter).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince > DRIFT_WINDOW_DAYS) return noSignal;
  if (latest.surprisePercent < MIN_BEAT_PERCENT) return noSignal;

  const { confirmed: priceConfirmed, changePct: priceChangePct } = validatePriceDirection(
    latest.quarter,
    ohlcHistory,
  );

  if (!priceConfirmed) {
    return {
      active: false,
      beatPercent: Math.round(latest.surprisePercent * 100) / 100,
      daysSinceEarnings: daysSince,
      daysInDriftWindow: DRIFT_WINDOW_DAYS - daysSince,
      score: 0,
      epsActual: latest.epsActual,
      epsEstimate: latest.epsEstimate,
      earningsDate: latest.quarter,
      priceConfirmed: false,
      priceChangePct,
    };
  }

  let score = scoreFromBeat(latest.surprisePercent);
  if (priceChangePct != null && priceChangePct >= 5) score = Math.min(100, score + 5);

  return {
    active: true,
    beatPercent: Math.round(latest.surprisePercent * 100) / 100,
    daysSinceEarnings: daysSince,
    daysInDriftWindow: DRIFT_WINDOW_DAYS - daysSince,
    score,
    epsActual: latest.epsActual,
    epsEstimate: latest.epsEstimate,
    earningsDate: latest.quarter,
    priceConfirmed,
    priceChangePct,
  };
}
