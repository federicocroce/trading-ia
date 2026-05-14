import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { NewsItem } from '@trading/shared';
import { getNewsBodiesByExternalIds, updateNewsBody } from '../db/repository.js';

// --- Constants ---

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_HOURS = 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
const CONCURRENCY = 8;
const MIN_BODY_LENGTH = 200; // below this we treat as failed extraction

const USER_AGENTS = [
  // Rotate to reduce blocking; all benign desktop browsers
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// --- Domain blocklist: paywalled sites, JS-heavy sites that require browser, or sites that block scrapers ---

const BLOCKED_DOMAINS = new Set([
  // Paywalled — body fetching unreliable
  'wsj.com',
  'ft.com',
  'bloomberg.com',
  'nytimes.com',
  'economist.com',
  'barrons.com',
  // Heavy JS / Readability falls back to nav menus (returns junk)
  'cnbc.com',         // Readability gets footer/nav
  'yahoo.com',        // Same — JS-heavy SPA
  'finance.yahoo.com',
  'seekingalpha.com',
  'marketwatch.com',  // blocks UA without browser
  // Aggregators (no original content)
  'flipboard.com',
  'feedly.com',
  'news.google.com',
]);

// Tier-1 sources we trust enough to use their summary as body when paywalled.
// Match against article.source name (case-insensitive substring).
const TIER_1_SOURCE_PATTERNS = [
  'reuters', 'bloomberg', 'wall street journal', 'wsj', 'financial times', 'ft.com',
  'the new york times', 'nytimes', 'ap news', 'associated press', 'cnbc', 'barron',
];

function isTier1Source(source: string): boolean {
  const s = source.toLowerCase();
  return TIER_1_SOURCE_PATTERNS.some(p => s.includes(p));
}

const MIN_SUMMARY_LENGTH = 200;

function isBlockedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    for (const blocked of BLOCKED_DOMAINS) {
      if (host === blocked || host.endsWith('.' + blocked)) return true;
    }
    return false;
  } catch {
    return true; // invalid URL → block
  }
}

// --- Cache validation ---

function isCacheFresh(bodyFetchedAt: string | null): boolean {
  if (!bodyFetchedAt) return false;
  const age = Date.now() - new Date(bodyFetchedAt).getTime();
  return age >= 0 && age < CACHE_TTL_MS;
}

// --- HTTP fetch with timeout + UA rotation ---

async function fetchHtml(url: string): Promise<string | null> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Readability extraction ---

function extractBody(html: string, url: string): string | null {
  try {
    const { document } = parseHTML(html);
    // linkedom needs a base URL set on the document for Readability's link resolution
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head?.prepend(base);
    // linkedom's Document is structurally compatible with Readability's expected DOM
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any);
    const article = reader.parse();
    if (!article || !article.textContent) return null;
    const text = article.textContent.trim().replace(/\s+/g, ' ');
    if (text.length < MIN_BODY_LENGTH) return null;
    if (!isQualityContent(text)) return null;
    return text;
  } catch {
    return null;
  }
}

// --- Content quality validator ---
// Detects footer/nav junk that Readability sometimes returns when site is JS-heavy
// (CNBC, Yahoo, etc.) — Readability falls back to text it sees, which may be all menus.

const NAV_PATTERNS = [
  /subscribe to/gi,
  /privacy policy/gi,
  /cookie policy/gi,
  /terms of (use|service)/gi,
  /sign up (for|now)/gi,
  /newsletter/gi,
  /follow us on/gi,
  /licensing & reprints/gi,
  /closed captioning/gi,
  /digital products/gi,
  /site map/gi,
  /careers/gi,
  /contact us/gi,
  /\bjoin (our|the) (panel|community)\b/gi,
];

const FINANCIAL_PROSE_MARKERS = [
  // English
  /\b(quarter|earnings|revenue|profit|loss|guidance|forecast|analyst|investor|share|stock|fed|rate|yield|inflation|company|market|trading|bond|yield)\b/gi,
  // Spanish
  /\b(trimestre|ganancias|ingresos|p[eé]rdidas|gu[ií]a|pron[oó]stico|analista|inversor|acci[oó]n|tasa|inflaci[oó]n|empresa|mercado|comercio|bono|rendimiento)\b/gi,
];

/**
 * Returns true if text looks like real article prose, false if it's nav/footer junk.
 * Uses heuristics:
 *  - sentence count >= 3 (real prose has full sentences)
 *  - nav-pattern density is low (< 1 nav phrase per 300 chars)
 *  - contains financial prose markers (not just nav menus)
 */
function isQualityContent(text: string): boolean {
  // 1. Sentence count: need at least 3 full sentences
  const sentences = text.split(/[.!?]+\s+[A-ZÁÉÍÓÚÑ]/);
  if (sentences.length < 3) return false;

  // 2. Nav pattern density: too many "Subscribe to..." patterns = junk
  let navHits = 0;
  for (const re of NAV_PATTERNS) {
    const matches = text.match(re);
    if (matches) navHits += matches.length;
  }
  const navDensity = navHits / (text.length / 300);
  if (navDensity > 1.0) return false;

  // 3. Must contain financial prose markers somewhere
  let financialHits = 0;
  for (const re of FINANCIAL_PROSE_MARKERS) {
    const matches = text.match(re);
    if (matches) financialHits += matches.length;
  }
  // Lifestyle articles still need at least 1 marker; financial articles will have many
  // Threshold: <2 markers in 1000+ char body = likely off-topic
  if (text.length > 1000 && financialHits < 2) return false;

  return true;
}

// --- Single fetch with cache check ---

export async function fetchAndCacheBody(item: { externalId: string; url: string }): Promise<string | null> {
  if (!item.url) return null;
  if (isBlockedDomain(item.url)) return null;

  const html = await fetchHtml(item.url);
  if (!html) return null;
  const body = extractBody(html, item.url);
  if (!body) return null;

  try {
    updateNewsBody(item.externalId, body);
  } catch (err) {
    console.warn(`[body-fetcher] DB write failed for ${item.externalId}:`, (err as Error).message?.slice(0, 80));
  }
  return body;
}

// --- Batch enrichment with concurrency cap and DB cache reuse ---

export async function enrichNewsWithBodies(news: NewsItem[]): Promise<NewsItem[]> {
  if (news.length === 0) return news;

  const ids = news.map(n => n.id);
  const cached = getNewsBodiesByExternalIds(ids);

  // Decide which need fetching, and apply tier-1 paywall fallback (use summary as body)
  let tier1Promoted = 0;
  const toFetch: Array<{ idx: number; externalId: string; url: string }> = [];
  const enriched: NewsItem[] = news.map((n, idx) => {
    const blocked = n.url ? isBlockedDomain(n.url) : false;

    // Tier-1 paywall path takes PRIORITY over cache: if domain is now blocked
    // (e.g. cnbc.com added to blocklist after first scrape) the cached body
    // may contain Readability junk. Prefer the adapter's summary instead.
    if (blocked && isTier1Source(n.source)) {
      const summaryUsable = (n.summary?.length ?? 0) >= MIN_SUMMARY_LENGTH;
      if (summaryUsable) {
        tier1Promoted++;
        return { ...n, body: n.summary, bodyFetchedAt: new Date().toISOString() };
      }
      // Fallback: synthesize a minimal body from title + tickers. Lets the LLM see
      // SOMETHING for tier-1 articles (CNBC/Reuters via Finnhub often return title-only).
      // Even short, the financial relevance filter will catch noise.
      const tickerStr = n.relatedTickers.length > 0 ? ` Tickers mencionados: ${n.relatedTickers.join(', ')}.` : '';
      const synthetic = `Fuente: ${n.source}. Titular: ${n.title}.${tickerStr}`;
      tier1Promoted++;
      return { ...n, body: synthetic, bodyFetchedAt: new Date().toISOString() };
    }

    // Cache path (only for non-blocked domains)
    const c = cached.get(n.id);
    if (!blocked && c?.body && isCacheFresh(c.bodyFetchedAt)) {
      return { ...n, body: c.body, bodyFetchedAt: c.bodyFetchedAt ?? undefined };
    }

    if (n.url && !blocked) toFetch.push({ idx, externalId: n.id, url: n.url });
    return n;
  });

  if (toFetch.length === 0) {
    console.log(`[body-fetcher] All ${news.length} bodies served from cache (tier1Promoted=${tier1Promoted})`);
    return enriched;
  }

  console.log(`[body-fetcher] Fetching ${toFetch.length}/${news.length} bodies (cache hit ${news.length - toFetch.length - tier1Promoted}, tier1Promoted=${tier1Promoted})`);

  // Concurrency-limited batching
  let fetched = 0;
  let failed = 0;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(b => fetchAndCacheBody({ externalId: b.externalId, url: b.url })),
    );
    results.forEach((r, j) => {
      const target = batch[j];
      if (r.status === 'fulfilled' && r.value) {
        enriched[target.idx] = { ...enriched[target.idx], body: r.value, bodyFetchedAt: new Date().toISOString() };
        fetched++;
      } else {
        failed++;
      }
    });
  }

  console.log(`[body-fetcher] Done: ${fetched} fetched, ${failed} failed (blocked/timeout/short)`);
  return enriched;
}
