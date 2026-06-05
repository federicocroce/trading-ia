/**
 * Guards against news/ticker mismatch (e.g. a Pampa headline attached to HSBC because the
 * upstream feed's relatedTickers was wrong). Conservative by design: only DROP a headline from
 * a symbol when we're confident it belongs to a *different* named company — never strip a
 * symbol's real news when we lack the data to judge.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive presence of `needle` in `text`. */
function mentions(text: string, needle: string): boolean {
  if (!needle) return false;
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(needle)}([^A-Za-z0-9]|$)`, 'i');
  return re.test(text);
}

/**
 * Does `headline` plausibly belong to `symbol`?
 * - true if it mentions the ticker symbol or any provided alias/company name.
 * - otherwise, DROP (false) only when the headline clearly names a DIFFERENT company
 *   (one of `otherKnownAliases`). A headline that names neither this symbol nor a competitor
 *   is kept — so real-but-unnamed news ("Oil giant beats earnings") is never lost, while a
 *   headline that names another company (PAM/YPF under BP) is removed even if it's the only one.
 */
export function headlineMatchesSymbol(
  headline: string,
  symbol: string,
  aliases: string[] = [],
  otherKnownAliases: string[] = [],
): boolean {
  if (!headline) return true;
  if (mentions(headline, symbol)) return true;
  for (const a of aliases) {
    if (mentions(headline, a)) return true;
  }
  // Not about this symbol by name → reject ONLY if it clearly names a different company.
  const foreign = otherKnownAliases.some((a) => mentions(headline, a));
  return !foreign;
}
