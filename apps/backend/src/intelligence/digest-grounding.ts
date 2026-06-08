/**
 * Grounds the digest's "would-buy" bullets against the actual scan so the LLM can't hallucinate:
 * - drops any item whose ticker is not a real BUY in the scan (e.g. an upgraded WATCH like XLE);
 * - replaces every price/stop/target with the scan's real tradeLevels (the engine owns the
 *   numbers, the LLM only owns the reasoning). Fabricated figures can never reach the UI.
 */

export interface GroundingOpp {
  symbol: string;
  action: string;            // 'BUY' | 'SELL' | 'HOLD' | 'WATCH'
  currentPrice: number;
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
}

/** Remove LLM-written money figures and stop/target/entry clauses from the prose. */
function stripNumbers(text: string): string {
  return text
    .replace(/\b(stop|target|entrada|entry|precio|objetivo)\b\s*[:=]?\s*\$?\s*[\d.,]+/gi, '')
    .replace(/\ba\s+\$\s*[\d.,]+/gi, '')
    .replace(/\$\s*[\d.,]+/g, '')
    .replace(/[ ,]+\./g, '.')
    .replace(/\.\s*\.+/g, '.')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

/**
 * @param opts.dropNonBuy when true (default, for MARKET picks), drops items that don't name a real
 *   BUY. When false (for PORTFOLIO items, which can be legit holds), keeps any item naming a known
 *   scanned ticker but still grounds its numbers; drops only items with no recognizable ticker.
 */
export function groundWouldBuyItems(
  items: string[],
  opps: GroundingOpp[],
  opts: { dropNonBuy?: boolean } = {},
): string[] {
  const dropNonBuy = opts.dropNonBuy ?? true;
  const buyMap = new Map<string, GroundingOpp>();
  const anyMap = new Map<string, GroundingOpp>();
  for (const o of opps) {
    const s = o.symbol.toUpperCase();
    anyMap.set(s, o);
    if (o.action === 'BUY') buyMap.set(s, o);
  }

  const out: string[] = [];
  for (const item of items) {
    const tokens = item.match(/\b[A-Z][A-Z0-9.-]{0,5}\b/g) ?? [];
    // Resolve the primary ticker: prefer a real BUY; otherwise (portfolio mode) any known ticker.
    let primary = tokens.find((t) => buyMap.has(t));
    if (!primary) {
      if (dropNonBuy) continue; // names no real BUY → drop (kills WATCH/SELL upgrades, no-ticker)
      primary = tokens.find((t) => anyMap.has(t));
      if (!primary) continue;   // no recognizable ticker at all → can't ground → drop
    }

    const opp = buyMap.get(primary) ?? anyMap.get(primary)!;
    let line = stripNumbers(item);
    if (opp.tradeLevels) {
      const tl = opp.tradeLevels;
      line = `${line} Entrada $${tl.entryPrice.toFixed(2)}, stop $${tl.stopLoss.toFixed(2)}, target $${tl.takeProfit.toFixed(2)}.`;
    }
    out.push(line.replace(/\s{2,}/g, ' ').trim());
  }
  return out;
}
