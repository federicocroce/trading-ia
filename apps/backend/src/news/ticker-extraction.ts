/**
 * Pure ticker extractor — kills the "ROAD-from-Broadband" class of hallucinations at the
 * source, instead of letting them flow downstream into `related_symbols` and eventually into
 * an LLM-authored recommendation.
 *
 * Root cause this replaces (see apps/backend/src/news/sources/rss.adapter.ts and
 * newsapi.adapter.ts, `findRelatedSymbols`, pre-fix): those functions uppercased the ENTIRE
 * article text and then ran `text.includes(SYMBOL)` — a case-insensitive SUBSTRING match with
 * no word boundary. "Liberty Broadband stock surges 15% on Comcast spinoff news", uppercased,
 * literally contains "ROAD" (B-ROAD-band) and "CAST" (Com-CAST) as substrings, so any ticker
 * shaped like that in the known-symbols universe (e.g. ROAD = Construction Partners Inc.) got
 * tagged onto an article that has nothing to do with it. Confirmed in prod: news_articles row
 * "Liberty Broadband stock surges 15% on Comcast spinoff news" (RSS:All News) has
 * related_symbols = ["GE","AS","CAST","OMC","AD","ROAD"] — none of which are real ALL-CAPS
 * tokens in the original title. Downstream, market_reports id=98 contains an LLM-authored
 * recommendation for "ROAD" whose thesis is entirely about Liberty Broadband/Comcast.
 *
 * This function instead:
 *  (a) only considers candidates that are themselves a complete, real word-boundary run of
 *      UPPERCASE letters in the ORIGINAL (case-preserved) text — a mixed-case word like
 *      "Broadband" can never yield "ROAD" because "road" inside it is lowercase and therefore
 *      never matches `[A-Z]`. (Never uppercase the whole text before matching — that is what
 *      turns a word-boundary regex into a de-facto substring match.)
 *  (b) requires every candidate to belong to a known `universe` of tickers passed in by the
 *      caller (portfolio + watchlist + discovered symbols, curated lists, etc.). When
 *      `universe` is omitted, this check is skipped — used for discovery paths, where the
 *      whole point is finding tickers NOT yet in any known universe; the existing Yahoo-quote
 *      validation (registerNovelTickers → validateTickers) is the gate there instead.
 *  (c) requires 1-2 letter tickers (EL, GE, ON, AS, T, F...) to appear with explicit ticker
 *      context — `$TICKER` or `(TICKER)` — since a bare 1-2 uppercase-letter token is far more
 *      likely to be a common word/preposition/abbreviation ("EL" in Spanish, "AS", "ON" in
 *      English) than an actual ticker mention.
 *  (d) rejects a blocklist of finance/macro acronyms that are never tickers, regardless of
 *      context or universe membership.
 */

// Finance/macro acronyms + common short words that must never be treated as tickers, even with
// explicit $/() context or if they somehow land in a caller's universe.
const BLOCKLIST = new Set([
  // Corporate roles / entity suffixes
  'CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CMO', 'VP', 'PM', 'HR', 'IT', 'PR', 'IR',
  'INC', 'LLC', 'LTD', 'CORP', 'PLC', 'CO',
  // Macro / regulators / institutions
  'FED', 'ECB', 'BOJ', 'IMF', 'NATO', 'OPEC', 'WHO', 'FBI', 'DOJ', 'IRS', 'FDA', 'EPA', 'ICE',
  'SEC', 'EIA', 'USA', 'US', 'UK', 'EU', 'UN',
  // Financial jargon / metrics
  'IPO', 'ETF', 'GDP', 'CPI', 'PCE', 'EPS', 'PE', 'ROE', 'ROA', 'ROI', 'YOY', 'QOQ', 'YTD',
  'AI', 'API', 'ESG', 'DEI', 'GAAP', 'FT', 'NYSE', 'NASDAQ',
  // Currencies
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ARS', 'BRL', 'CAD', 'AUD', 'NZD',
  // Quarters
  'Q1', 'Q2', 'Q3', 'Q4',
  // Common words that show up capitalized (headline-case or emphasis) in news text
  'BUY', 'SELL', 'HOLD', 'NEW', 'TOP', 'ALL', 'FOR', 'THE', 'AND', 'NOT', 'NOW',
  'BREAKING', 'UPDATE', 'ALERT', 'NEWS', 'REPORT', 'ANALYSIS',
]);

const TICKER_SUFFIX = '(?:-USD|-USDT)?';

// $TICKER or (TICKER): explicit context. Accepts 1-5 letters — this is the ONLY way a 1-2
// letter ticker can be extracted (rule c).
const EXPLICIT_RE = new RegExp(`\\$([A-Z]{1,5}${TICKER_SUFFIX})\\b|\\(([A-Z]{1,5}${TICKER_SUFFIX})\\)`, 'g');

// Bare word-boundary run of 3-5 uppercase letters. 1-2 letter runs are intentionally excluded
// here — they must go through EXPLICIT_RE instead (rule c).
const BARE_RE = new RegExp(`\\b([A-Z]{3,5}${TICKER_SUFFIX})\\b`, 'g');

export function extractTickersFromText(text: string, universe?: Set<string>): string[] {
  if (!text) return [];

  const candidates = new Set<string>();

  for (const re of [EXPLICIT_RE, BARE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const candidate = m[1] ?? m[2];
      if (candidate) candidates.add(candidate);
    }
  }

  return [...candidates].filter((t) => {
    if (BLOCKLIST.has(t)) return false;
    if (universe && !universe.has(t)) return false;
    return true;
  });
}
