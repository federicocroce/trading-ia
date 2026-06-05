/**
 * Defends against split-poisoned / garbage moving averages from unadjusted feeds.
 * A reverse-split ticker can carry pre-split closes (e.g. SMA200 $217 while price is $9),
 * which corrupts trend filters and scoring. We null any SMA implausibly far from price.
 */

export const DEFAULT_SMA_MAX_RATIO = Number(process.env.SMA_SANITY_MAX_RATIO ?? '4');

/** Returns the SMA if plausible vs current price, else null. Keeps it when price is unknown (0). */
export function sanitizeSMA(
  sma: number | null,
  currentPrice: number,
  maxRatio: number = DEFAULT_SMA_MAX_RATIO,
): number | null {
  if (sma == null) return null;
  if (!Number.isFinite(sma)) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return sma; // no reference to judge
  const hi = currentPrice * maxRatio;
  const lo = currentPrice / maxRatio;
  if (sma > hi || sma < lo) return null;
  return sma;
}

export interface MovingAverages {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
}

export interface SanitizedMovingAverages extends MovingAverages {
  flags: string[]; // names of SMAs that were nulled as implausible
}

export function sanitizeMovingAverages(
  ma: MovingAverages,
  currentPrice: number,
  maxRatio: number = DEFAULT_SMA_MAX_RATIO,
): SanitizedMovingAverages {
  const flags: string[] = [];
  const check = (name: keyof MovingAverages, v: number | null): number | null => {
    const out = sanitizeSMA(v, currentPrice, maxRatio);
    if (v != null && out == null) flags.push(name);
    return out;
  };
  return {
    sma20: check('sma20', ma.sma20),
    sma50: check('sma50', ma.sma50),
    sma200: check('sma200', ma.sma200),
    flags,
  };
}
