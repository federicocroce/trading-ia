import type {
  NewsItem,
  RadarPerArticle,
  RadarImpactItem,
  RadarAggregatedSignal,
  NewsRadarSnapshot,
} from '@trading/shared';
import { NEWS_RADAR_PROMPT, TICKER_TO_SECTOR } from '@trading/shared';
import { callAIWithModel } from '../shared/ai-router.js';
import { insertNewsRadarSnapshot } from '../db/repository.js';
import { validateTicker } from '../discovery/ticker-validator.js';
import { jsonrepair } from 'jsonrepair';

// --- Confidence weighting (used to scale votes during aggregation) ---

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

// Ticker→Sector map lives in @trading/shared so frontend can do reverse lookup
// (sector → tickers) when user clicks a sector signal in the radar UI.

// --- LLM call ---

interface LLMResponse {
  news?: Array<{
    newsId: string;
    cause?: string;
    positive?: Array<{ target?: string; type?: string }>;
    negative?: Array<{ target?: string; type?: string }>;
  }>;
  emergingNarratives?: string[];
}

function buildUserPayload(news: NewsItem[]): string {
  // Compact payload: newsId + title + body + source + confidence
  // Body truncated to 1500 chars to keep tokens manageable
  const items = news.map(n => ({
    newsId: n.id,
    source: n.source,
    confidence: n.triangulation?.confidence ?? 'unknown',
    title: n.title,
    body: (n.body ?? '').slice(0, 1500),
  }));
  return `Noticias filtradas a analizar (${news.length}):\n${JSON.stringify(items)}`;
}

function parseLLMOutput(raw: string): LLMResponse | null {
  try {
    return JSON.parse(raw) as LLMResponse;
  } catch {
    // Try to repair malformed JSON
    try {
      return JSON.parse(jsonrepair(raw)) as LLMResponse;
    } catch {
      return null;
    }
  }
}

// Patterns to reject leveraged/exotic ETFs that LLMs sometimes hallucinate
const LEVERAGED_TICKER_PATTERNS = [
  /^(TQQQ|TNA|SOXL|FAS|FAZ|UPRO|SPXL|SPXU|UVXY|SVXY|BULL|BEAR|JNUG|JDST|NUGT|DUST|LABU|LABD|ERX|ERY|GUSH|DRIP|YINN|YANG|TZA|SDOW|UDOW|QID|SQQQ)$/i,
  /3X|ULTRA|DAILY/i,
];

function isLeveragedTicker(target: string): boolean {
  return LEVERAGED_TICKER_PATTERNS.some(p => p.test(target));
}

function sanitizeImpactItems(items: Array<{ target?: string; type?: string }> | undefined): RadarImpactItem[] {
  if (!Array.isArray(items)) return [];
  const cleaned: RadarImpactItem[] = [];
  for (const item of items) {
    if (!item.target || typeof item.target !== 'string') continue;
    const target = item.target.trim();
    if (target.length === 0 || target.length > 30) continue;
    const type: 'ticker' | 'sector' = item.type === 'ticker' ? 'ticker' : 'sector';
    // Reject leveraged ETFs (LLM hallucinations like TNA, SOXL, etc.)
    if (type === 'ticker' && isLeveragedTicker(target)) continue;
    cleaned.push({ target, type });
  }
  return cleaned;
}

/**
 * For each ticker that has a known parent sector in TICKER_TO_SECTOR map,
 * ensure that sector is ALSO present in the same direction. Auto-cascades
 * ticker votes into sector signals. The discount logic in aggregation halves
 * the ticker weight so we don't double-count.
 */
function cascadeTickerToSectors(items: RadarImpactItem[]): RadarImpactItem[] {
  const sectorsPresent = new Set(items.filter(i => i.type === 'sector').map(i => i.target.toLowerCase()));
  const cascaded: RadarImpactItem[] = [...items];
  for (const item of items) {
    if (item.type !== 'ticker') continue;
    const parent = TICKER_TO_SECTOR[item.target.toUpperCase()];
    if (!parent) continue;
    if (sectorsPresent.has(parent.toLowerCase())) continue;
    cascaded.push({ target: parent, type: 'sector' });
    sectorsPresent.add(parent.toLowerCase());
  }
  return cascaded;
}

// --- Aggregation with ticker/sector overlap discount ---

const TICKER_DISCOUNT_FACTOR = 0.5;

/**
 * Aggregates per-article impact items into ranked signals.
 *
 * Discount logic: if an article votes both a ticker AND its parent sector in the
 * same direction, the ticker vote is downweighted by TICKER_DISCOUNT_FACTOR (0.5)
 * to avoid double-counting (e.g. voting both "ITB" and "homebuilders" negative
 * shouldn't count as 2 independent signals — it's the same logical bet).
 */
export function aggregateRadar(perArticle: RadarPerArticle[], confidenceMap: Map<string, string>): RadarAggregatedSignal[] {
  type Bucket = {
    target: string;
    type: 'ticker' | 'sector';
    pos: number;
    neg: number;
    posArticles: Set<string>;
    negArticles: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  const keyOf = (item: RadarImpactItem) => `${item.type}:${item.target.toLowerCase()}`;

  for (const article of perArticle) {
    const conf = confidenceMap.get(article.newsId) ?? 'medium';
    const baseWeight = CONFIDENCE_WEIGHTS[conf] ?? 0.6;

    // Compute parent-sector set in this article (per direction) for discount
    const parentSectorsPos = new Set<string>();
    const parentSectorsNeg = new Set<string>();
    for (const it of article.positive) {
      if (it.type === 'sector') parentSectorsPos.add(it.target.toLowerCase());
    }
    for (const it of article.negative) {
      if (it.type === 'sector') parentSectorsNeg.add(it.target.toLowerCase());
    }

    const recordVote = (item: RadarImpactItem, direction: 'pos' | 'neg') => {
      const key = keyOf(item);
      let weight = baseWeight;

      // Apply discount if this is a ticker AND its parent sector is also voted same direction
      if (item.type === 'ticker') {
        const parentSector = TICKER_TO_SECTOR[item.target.toUpperCase()];
        if (parentSector) {
          const parentSet = direction === 'pos' ? parentSectorsPos : parentSectorsNeg;
          if (parentSet.has(parentSector)) {
            weight *= TICKER_DISCOUNT_FACTOR;
          }
        }
      }

      const b = buckets.get(key) ?? {
        target: item.target,
        type: item.type,
        pos: 0,
        neg: 0,
        posArticles: new Set<string>(),
        negArticles: new Set<string>(),
      };
      if (direction === 'pos') {
        b.pos += weight;
        b.posArticles.add(article.newsId);
      } else {
        b.neg += weight;
        b.negArticles.add(article.newsId);
      }
      buckets.set(key, b);
    };

    for (const it of article.positive) recordVote(it, 'pos');
    for (const it of article.negative) recordVote(it, 'neg');
  }

  const signals: RadarAggregatedSignal[] = [...buckets.values()].map(b => ({
    target: b.target,
    type: b.type,
    positiveScore: Number(b.pos.toFixed(2)),
    negativeScore: Number(b.neg.toFixed(2)),
    netScore: Number((b.pos - b.neg).toFixed(2)),
    totalScore: Number((b.pos + b.neg).toFixed(2)),
    positiveArticles: [...b.posArticles],
    negativeArticles: [...b.negArticles],
  }));

  // Sort by total score (volume) descending; ties by abs net descending
  signals.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return Math.abs(b.netScore) - Math.abs(a.netScore);
  });

  return signals;
}

// --- Ticker validation against Yahoo (drops LLM hallucinations) ---

async function dropInvalidTickers(perArticle: RadarPerArticle[]): Promise<void> {
  // Collect all unique tickers across articles
  const allTickers = new Set<string>();
  for (const a of perArticle) {
    for (const it of a.positive) if (it.type === 'ticker') allTickers.add(it.target);
    for (const it of a.negative) if (it.type === 'ticker') allTickers.add(it.target);
  }
  if (allTickers.size === 0) return;

  // Skip validation for tickers we KNOW are valid (in TICKER_TO_SECTOR map)
  const toValidate: string[] = [];
  const knownValid = new Set<string>();
  for (const t of allTickers) {
    if (TICKER_TO_SECTOR[t.toUpperCase()]) {
      knownValid.add(t);
    } else {
      toValidate.push(t);
    }
  }

  // Validate unknown tickers against Yahoo (parallel, with timeout)
  const validationResults = await Promise.allSettled(
    toValidate.map(async (t) => ({ ticker: t, valid: await validateTicker(t) })),
  );
  const validated = new Set<string>(knownValid);
  let dropped = 0;
  for (const r of validationResults) {
    if (r.status === 'fulfilled' && r.value.valid) {
      validated.add(r.value.ticker);
    } else if (r.status === 'fulfilled') {
      dropped++;
    }
  }

  if (dropped > 0) {
    console.log(`[news-radar] Dropped ${dropped} invalid tickers (Yahoo rejected)`);
  }

  // Filter perArticle in-place
  for (const a of perArticle) {
    a.positive = a.positive.filter(it => it.type !== 'ticker' || validated.has(it.target));
    a.negative = a.negative.filter(it => it.type !== 'ticker' || validated.has(it.target));
  }
}

// --- Main entry point ---

export async function generateNewsRadar(
  news: NewsItem[],
  options?: { pipelineRunId?: number; persist?: boolean },
): Promise<NewsRadarSnapshot> {
  if (news.length === 0) {
    return {
      generatedAt: Date.now(),
      totalNewsAnalyzed: 0,
      perArticle: [],
      aggregatedSignals: [],
    };
  }

  const start = Date.now();
  const userMsg = buildUserPayload(news);

  let raw: string;
  let model: string;
  try {
    // 'extraction' task → Groq 70B (Llama 70B) primary with key rotation,
    // fallbacks Groq Light → Gemini Flash → Qwen. Better accuracy for ticker/sector
    // extraction than gemma2/8b alone.
    const result = await callAIWithModel('extraction', userMsg, NEWS_RADAR_PROMPT, 4096);
    raw = result.content;
    model = result.model;
  } catch (err) {
    console.error('[news-radar] LLM call failed:', (err as Error).message);
    return {
      generatedAt: Date.now(),
      totalNewsAnalyzed: news.length,
      perArticle: [],
      aggregatedSignals: [],
      durationMs: Date.now() - start,
    };
  }

  const parsed = parseLLMOutput(raw);
  if (!parsed || !Array.isArray(parsed.news)) {
    console.error('[news-radar] LLM returned invalid JSON or missing "news" array');
    return {
      generatedAt: Date.now(),
      totalNewsAnalyzed: news.length,
      perArticle: [],
      aggregatedSignals: [],
      llmModel: model,
      durationMs: Date.now() - start,
    };
  }

  // Validate each article output
  const perArticle: RadarPerArticle[] = [];
  const validNewsIds = new Set(news.map(n => n.id));
  for (const a of parsed.news) {
    if (!a.newsId || !validNewsIds.has(a.newsId)) continue;
    const cause = typeof a.cause === 'string' ? a.cause.trim().slice(0, 200) : '';
    if (!cause) continue;
    perArticle.push({
      newsId: a.newsId,
      cause,
      positive: cascadeTickerToSectors(sanitizeImpactItems(a.positive)),
      negative: cascadeTickerToSectors(sanitizeImpactItems(a.negative)),
    });
  }

  // P4: Validate tickers against Yahoo to drop hallucinations (BOS, TNA, etc.)
  // Single batch validation across all articles. Cached internally so re-runs are fast.
  await dropInvalidTickers(perArticle);

  // Build confidence map for aggregation
  const confidenceMap = new Map<string, string>();
  for (const n of news) {
    confidenceMap.set(n.id, n.triangulation?.confidence ?? 'medium');
  }

  const aggregatedSignals = aggregateRadar(perArticle, confidenceMap);

  const emergingNarratives = Array.isArray(parsed.emergingNarratives)
    ? parsed.emergingNarratives.filter((s): s is string => typeof s === 'string').slice(0, 5)
    : undefined;

  const snapshot: NewsRadarSnapshot = {
    generatedAt: Date.now(),
    totalNewsAnalyzed: news.length,
    perArticle,
    aggregatedSignals,
    emergingNarratives,
    llmModel: model,
    durationMs: Date.now() - start,
  };

  console.log(`[news-radar] ${perArticle.length}/${news.length} articles analyzed, ${aggregatedSignals.length} unique targets aggregated`);

  // Persist by default unless explicitly disabled
  if (options?.persist !== false) {
    try {
      insertNewsRadarSnapshot({
        pipelineRunId: options?.pipelineRunId ?? null,
        totalNewsAnalyzed: snapshot.totalNewsAnalyzed,
        perArticle: JSON.stringify(snapshot.perArticle),
        aggregatedSignals: JSON.stringify(snapshot.aggregatedSignals),
        emergingNarratives: snapshot.emergingNarratives ? JSON.stringify(snapshot.emergingNarratives) : undefined,
        llmModel: snapshot.llmModel,
        durationMs: snapshot.durationMs,
      });
    } catch (err) {
      console.warn('[news-radar] Failed to persist snapshot:', (err as Error).message?.slice(0, 100));
    }
  }

  return snapshot;
}
