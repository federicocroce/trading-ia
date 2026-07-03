/**
 * Cliente I/O para los screeners predefinidos de Yahoo Finance (most_actives, day_gainers,
 * day_losers). Trae candidatos operables de TODO el mercado, no solo del universo hardcodeado
 * de watchlist/discovered symbols.
 *
 * Puro I/O: fetch + mapeo al shape mínimo. El embudo de filtrado vive en
 * `discovery/market-screener.ts` (puro, testeable sin red). Sin cache propio — se llama
 * una vez por corrida del pipeline de descubrimiento.
 */

import type { ScreenerQuote } from '../discovery/market-screener.js';

const SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';
const SCR_IDS = ['most_actives', 'day_gainers', 'day_losers'] as const;
const COUNT_PER_LIST = 100;

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

interface YahooScreenerQuote {
  symbol?: string;
  shortName?: string;
  longName?: string;
  marketCap?: number | null;
  regularMarketPrice?: number | null;
  regularMarketVolume?: number | null;
  regularMarketChangePercent?: number | null;
}

interface YahooScreenerResponse {
  finance: {
    result: Array<{ quotes: YahooScreenerQuote[] }> | null;
    error: { code: string; description: string } | null;
  };
}

function toScreenerQuote(q: YahooScreenerQuote): ScreenerQuote | null {
  if (!q.symbol || q.regularMarketPrice == null) return null;
  return {
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    marketCap: q.marketCap ?? null,
    price: q.regularMarketPrice,
    volume: q.regularMarketVolume ?? 0,
    // Fail-closed: NO defaultear a 0 — un changePct faltante disfrazado de "plano"
    // pasaría el anti-chase del embudo. null explícito, igual que marketCap.
    changePct: q.regularMarketChangePercent ?? null,
  };
}

async function fetchScreenerList(scrId: (typeof SCR_IDS)[number]): Promise<ScreenerQuote[]> {
  const url = `${SCREENER_URL}?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=${COUNT_PER_LIST}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });

  if (!res.ok) {
    throw new Error(`Yahoo Screener HTTP ${res.status} para ${scrId}`);
  }

  const data = (await res.json()) as YahooScreenerResponse;
  const quotes = data.finance?.result?.[0]?.quotes ?? [];

  const out: ScreenerQuote[] = [];
  for (const q of quotes) {
    const mapped = toScreenerQuote(q);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Trae las 3 listas de screeners predefinidos de Yahoo en paralelo. Una lista caída
 * (network error, HTTP no-ok) no tumba las otras — se descarta con warning y se sigue.
 * No dedupea (eso lo hace el embudo puro `filterScreenerCandidates`).
 */
export async function fetchScreenerQuotes(): Promise<ScreenerQuote[]> {
  const results = await Promise.allSettled(SCR_IDS.map((scrId) => fetchScreenerList(scrId)));

  const quotes: ScreenerQuote[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      quotes.push(...r.value);
    } else {
      console.warn(`[Yahoo Screener] Falló ${SCR_IDS[i]}:`, (r.reason as Error)?.message ?? r.reason);
    }
  }

  return quotes;
}
