/** Simple daily returns from a close-price series. */
export function toReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev === 0) { out.push(0); continue; }
    out.push((closes[i] - prev) / prev);
  }
  return out;
}

/** Pearson correlation. Aligns series at the END (most recent), truncating to the shorter.
 *  Returns NaN if fewer than 2 overlapping points or zero variance. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const aa = a.slice(a.length - n);
  const bb = b.slice(b.length - n);
  const meanA = aa.reduce((s, x) => s + x, 0) / n;
  const meanB = bb.reduce((s, x) => s + x, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aa[i] - meanA, db = bb[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA === 0 || denB === 0) return NaN;
  return num / Math.sqrt(denA * denB);
}
