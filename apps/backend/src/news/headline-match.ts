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
 * - if no aliases are known: true unless the headline mentions one of `otherKnownAliases`
 *   (a competing company) and not this symbol — i.e. only reject when clearly foreign.
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
  // No direct match. Only reject if the headline clearly belongs to another named company.
  if (aliases.length === 0 && otherKnownAliases.length > 0) {
    const foreign = otherKnownAliases.some((a) => mentions(headline, a));
    return !foreign;
  }
  // We have aliases for this symbol but none matched → likely foreign → reject.
  return aliases.length === 0;
}
