import type { NewsItem } from '@trading/shared';

// --- Filter configuration ---

export interface DeepAnalysisFilterOptions {
  maxAge?: { highHours: number; otherHours: number };  // recency caps
  minBodyLength?: number;                                // chars
  bodySimilarityThreshold?: number;                      // jaccard 0-1
  topN?: number;                                          // cap output
  requireBody?: boolean;                                  // if false, allow body-less items through
  minFinancialRelevance?: number;                        // min count of financial markers in body
}

const DEFAULT_OPTIONS: Required<DeepAnalysisFilterOptions> = {
  maxAge: { highHours: 24, otherHours: 12 },
  minBodyLength: 80,                   // permite synthetic bodies tier-1 (title+tickers ~120 chars)
  bodySimilarityThreshold: 0.6,
  topN: 60,
  requireBody: true,
  minFinancialRelevance: 2,  // tier-1 synthetic bodies tienen pocos markers; density check filtra noise
};

// --- Financial relevance: keyword-based scoring ---
// Counts mentions of money, percentages, market terms, sectors, instruments.
// Articles below threshold are off-topic (lifestyle, sports, HR, etc.)

const MONEY_PATTERNS = [
  /\$\d/g,                                             // $5, $1.5B
  /\d+(\.\d+)?\s*(%|percent|por\s*ciento)/gi,          // 5%, 3.2 percent
  /\b\d+(\.\d+)?\s*(billion|million|trillion|bn|mn)\b/gi,  // 1.5 billion
  /\b\d+(\.\d+)?\s*(billones?|millones?|trillones?)\b/gi, // 1.5 millones
];

const MARKET_TERMS = [
  // English
  /\b(stock|stocks|shares?|equity|equities|bond|bonds|treasury|yields?|spread|index|indices|etf|futures|options|commodity|commodities)\b/gi,
  /\b(earnings|revenue|profit|loss|margin|ebitda|guidance|forecast|outlook|dividend|buyback)\b/gi,
  /\b(fed|federal reserve|ecb|boj|interest rate|rate cut|rate hike|inflation|cpi|pce|gdp|recession)\b/gi,
  /\b(opec|tariff|trade war|sanction|geopolitical|crude|brent|wti|gold|silver|copper)\b/gi,
  /\b(nasdaq|nyse|s&p|dow jones|russell|vix|merval|cedear|adr)\b/gi,
  /\b(bull|bear|rally|sell-off|correction|volatility|momentum|breakout)\b/gi,
  // Spanish
  /\b(acci[oó]n|acciones|bonos?|tesoro|rendimientos?|[íi]ndice|fondo|mercado|bolsa)\b/gi,
  /\b(ganancias|ingresos|beneficio|p[eé]rdida|margen|gu[ií]a|pron[oó]stico|dividendo|recompra)\b/gi,
  /\b(reserva federal|tasa|tasas? de inter[eé]s|inflaci[oó]n|recesi[oó]n)\b/gi,
  /\b(arancel|aranceles|guerra comercial|sanciones?|geopol[ií]tic[ao]|petr[oó]leo|oro|plata|cobre)\b/gi,
];

function countFinancialMarkers(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const re of MONEY_PATTERNS) {
    const m = text.match(re);
    if (m) count += m.length;
  }
  for (const re of MARKET_TERMS) {
    const m = text.match(re);
    if (m) count += m.length;
  }
  return count;
}

// --- Source tier classification ---

const TIER_1_SOURCES = new Set([
  'reuters', 'bloomberg', 'wall street journal', 'wsj', 'financial times', 'ft',
  'the new york times', 'nytimes', 'ap news', 'associated press', 'cnbc',
]);

const TIER_2_SOURCES = new Set([
  'yahoo finance', 'marketwatch', 'investopedia', 'forbes', 'business insider',
  'reuters', 'finnhub', 'cnn business', 'fortune', 'barron', 'the economist',
  'newsapi',
]);

const BLOCKED_SOURCES = new Set([
  // SEO blogs / aggregators / low-quality content farms
  'seekingalpha',  // contributor-quality varies; often opinion not news
  'zacks',         // mostly automated content
  'investorplace',
  'fool.com',      // motley fool — opinion blog
  'benzinga',      // mixed quality
]);

function getSourceTier(source: string): 'tier1' | 'tier2' | 'blocked' | 'unknown' {
  const s = source.toLowerCase();
  for (const t1 of TIER_1_SOURCES) if (s.includes(t1)) return 'tier1';
  for (const blocked of BLOCKED_SOURCES) if (s.includes(blocked)) return 'blocked';
  for (const t2 of TIER_2_SOURCES) if (s.includes(t2)) return 'tier2';
  return 'unknown';
}

// --- Body similarity (jaccard on word-level tokens) ---

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\sñáéíóú]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// --- Main filter ---

export interface FilterResult {
  kept: NewsItem[];
  dropped: {
    confidence: number;
    recency: number;
    source: number;
    bodyLength: number;
    financialRelevance: number;
    duplicateBody: number;
    topNCap: number;
  };
}

/**
 * Filter news items for deep LLM analysis. Applies a sequence of filters:
 * 1. confidence (drop low UNLESS source is tier1)
 * 2. recency (drop > maxAge.otherHours UNLESS confidence=high which gets maxAge.highHours)
 * 3. source tier (drop blocked sources)
 * 4. body length (drop if body missing or < minBodyLength)
 * 5. body similarity dedup (drop if jaccard >= threshold against an already-kept item)
 * 6. cap to topN (sorted by confidence desc, then recency desc)
 */
export function filterForDeepAnalysis(
  news: NewsItem[],
  options?: DeepAnalysisFilterOptions,
): FilterResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dropped: FilterResult['dropped'] = {
    confidence: 0, recency: 0, source: 0, bodyLength: 0, financialRelevance: 0, duplicateBody: 0, topNCap: 0,
  };

  let candidates = news.slice();

  // Filter 1: confidence
  candidates = candidates.filter(n => {
    const conf = n.triangulation?.confidence ?? 'low';
    if (conf === 'low') {
      const tier = getSourceTier(n.source);
      if (tier !== 'tier1') {
        dropped.confidence++;
        return false;
      }
    }
    return true;
  });

  // Filter 2: recency
  const now = Date.now();
  candidates = candidates.filter(n => {
    const ageMs = now - new Date(n.time).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const conf = n.triangulation?.confidence ?? 'low';
    const maxHours = conf === 'high' ? opts.maxAge.highHours : opts.maxAge.otherHours;
    if (ageHours > maxHours) {
      dropped.recency++;
      return false;
    }
    return true;
  });

  // Filter 3: source tier (drop explicitly blocked)
  candidates = candidates.filter(n => {
    const tier = getSourceTier(n.source);
    if (tier === 'blocked') {
      dropped.source++;
      return false;
    }
    return true;
  });

  // Filter 4: body length
  if (opts.requireBody) {
    candidates = candidates.filter(n => {
      if (!n.body || n.body.length < opts.minBodyLength) {
        dropped.bodyLength++;
        return false;
      }
      return true;
    });
  }

  // Filter 4.5: financial relevance — drop articles where markers are TOO SPARSE.
  // Uses BOTH absolute count + density (markers per 1000 chars). Lifestyle articles
  // mention "$X" or "company" casually but at very low density; real financial news
  // has 2-5+ markers per 1000 chars.
  if (opts.requireBody && opts.minFinancialRelevance > 0) {
    candidates = candidates.filter(n => {
      const text = `${n.title} ${n.body ?? ''}`;
      const score = countFinancialMarkers(text);
      const bodyLen = (n.body?.length ?? 0) + n.title.length;
      const density = bodyLen > 0 ? (score / bodyLen) * 1000 : 0;
      // Drop if either: too few absolute markers OR too low density (sparse, off-topic)
      const MIN_DENSITY_PER_1000 = 2.0;
      if (score < opts.minFinancialRelevance || density < MIN_DENSITY_PER_1000) {
        dropped.financialRelevance++;
        return false;
      }
      return true;
    });
  }

  // Filter 5: dedup using BOTH title-jaccard (catches "X Earnings Press Release"
  // vs "X Earnings Presentation") AND body-jaccard (catches verbatim reposts).
  // Sort by body length desc so we keep the most complete version.
  const TITLE_DUP_THRESHOLD = 0.55;  // title token overlap
  candidates.sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0));
  const kept: NewsItem[] = [];
  const keptTitleTokens: Set<string>[] = [];
  const keptBodyTokens: Set<string>[] = [];
  for (const n of candidates) {
    const titleTokens = tokenize(n.title);
    const bodyTokens = tokenize(n.body ?? n.title);
    let isDup = false;
    for (let i = 0; i < kept.length; i++) {
      if (jaccard(titleTokens, keptTitleTokens[i]) >= TITLE_DUP_THRESHOLD) {
        isDup = true;
        break;
      }
      if (jaccard(bodyTokens, keptBodyTokens[i]) >= opts.bodySimilarityThreshold) {
        isDup = true;
        break;
      }
    }
    if (isDup) {
      dropped.duplicateBody++;
      continue;
    }
    kept.push(n);
    keptTitleTokens.push(titleTokens);
    keptBodyTokens.push(bodyTokens);
  }

  // Filter 6: top-N cap
  // Sort by confidence (high > medium > low > undefined) DESC, then recency DESC
  const confRank = (c: string | undefined): number => c === 'high' ? 3 : c === 'medium' ? 2 : c === 'low' ? 1 : 0;
  kept.sort((a, b) => {
    const ca = confRank(a.triangulation?.confidence);
    const cb = confRank(b.triangulation?.confidence);
    if (ca !== cb) return cb - ca;
    return new Date(b.time).getTime() - new Date(a.time).getTime();
  });

  if (kept.length > opts.topN) {
    dropped.topNCap = kept.length - opts.topN;
    kept.length = opts.topN;
  }

  return { kept, dropped };
}

// --- Diagnostic logging helper ---

export function logFilterStats(input: number, result: FilterResult): void {
  const d = result.dropped;
  console.log(
    `[news-filters] ${input} → ${result.kept.length} kept ` +
    `(dropped: confidence=${d.confidence}, recency=${d.recency}, source=${d.source}, ` +
    `bodyLength=${d.bodyLength}, financialRelevance=${d.financialRelevance}, duplicateBody=${d.duplicateBody}, topNCap=${d.topNCap})`,
  );
}
