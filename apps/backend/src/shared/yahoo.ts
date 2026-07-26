import type { Price, OHLC, FundamentalData } from '@trading/shared';
import { reportOk, reportError } from './service-health.js';
import { withRetry } from './retry.js';
import { envNumber } from './env-number.js';
import { createFetchGate, type FetchGate } from './fetch-gate.js';

const SVC_PRICES = 'Yahoo Precios';
const SVC_FUNDAMENTALS = 'Yahoo Fundamentales';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const EMPTY_EXTENDED_FUNDAMENTALS = {
  revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null,
  debtToEquity: null, freeCashFlow: null, returnOnEquity: null, returnOnAssets: null,
  earningsSurprise: null, nextEarningsDate: null,
} as const;

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

// --- Global concurrency limiter for ALL Yahoo HTTP calls ---
// Yahoo resets/throttles connections when hit with ~100+ simultaneous requests
// from one IP. The "fetch failed" wall happens because getQuotes() fans out the
// whole universe (~140 symbols) at once via Promise.allSettled, and the scan +
// market-regime bursts pile on top. A single shared ceiling keeps every fan-out
// under one limit instead of each blasting the universe in parallel — retries
// then succeed because the burst is spread out, not because Yahoo "recovered".
//
// El gate tiene carril de prioridad: las llamadas interactivas (navegar a un
// símbolo) saltan por delante del barrido del ticker si el pipe está lleno.
const _rawFetch = globalThis.fetch;
let _yahooGate: FetchGate | null = null;
function yahooGate(): FetchGate {
  // Lazy: envNumber se lee dentro de la función (el hoisting ESM corre antes de dotenv).
  if (!_yahooGate) _yahooGate = createFetchGate(envNumber('YAHOO_MAX_CONCURRENT', 6));
  return _yahooGate;
}

/** fetch() wrapper que acota las conexiones concurrentes a Yahoo. */
async function yfetch(
  input: string,
  init?: RequestInit,
  opts?: { priority?: boolean },
): Promise<Response> {
  const gate = yahooGate();
  await gate.acquire(opts);
  try {
    return await _rawFetch(input, init);
  } finally {
    gate.release();
  }
}

interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice: number;
    previousClose: number;
    chartPreviousClose: number;
    marketState?: string;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    averageDailyVolume10Day?: number;
  };
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
    adjclose?: Array<{ adjclose: (number | null)[] }>;
  };
}

interface YahooResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}

export async function getQuote(symbol: string, opts?: { priority?: boolean }): Promise<Price> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  const res = await withRetry(
    () => yfetch(url, { headers: YAHOO_HEADERS }, opts),
    `Yahoo:${symbol}`,
    { maxRetries: 2, baseDelayMs: 1000 },
  );

  if (!res.ok) {
    reportError(SVC_PRICES, `HTTP ${res.status} para ${symbol}`);
    throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);
  }

  const data = (await res.json()) as YahooResponse;

  if (!data.chart.result || data.chart.result.length === 0) {
    throw new Error(`No data for ${symbol}`);
  }

  const meta = data.chart.result[0].meta;
  const quotes = data.chart.result[0].indicators.quote[0];

  const current = meta.regularMarketPrice;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose;
  const change = current - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  // Get today's OHLC from the quote data
  const todayOpen = quotes.open?.[quotes.open.length - 1] ?? current;
  const todayHigh = quotes.high?.[quotes.high.length - 1] ?? current;
  const todayLow = quotes.low?.[quotes.low.length - 1] ?? current;

  reportOk(SVC_PRICES);
  return {
    symbol,
    open: todayOpen,
    current,
    high: todayHigh,
    low: todayLow,
    previousClose,
    change,
    changePercent,
    timestamp: Date.now(),
    marketState: meta.marketState,
  };
}

// --- Batch quotes (endpoint v7/quote) ---
// Un request trae hasta ~50 símbolos; reemplaza el fan-out 1-request-por-símbolo
// que saturaba el limitador global y disparaba el throttling de Yahoo.

interface RawV7Quote {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  marketState?: string;
}

interface YahooV7QuoteResponse {
  quoteResponse?: {
    result?: RawV7Quote[] | null;
    error?: { code: string; description: string } | null;
  };
}

/** Parte una lista en grupos de a lo sumo `size` (puro). */
export function chunkSymbols(symbols: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

/**
 * Mapea un item del endpoint v7 a Price (puro). Fail-closed: sin
 * `regularMarketPrice` devuelve null en vez de inventar un precio 0.
 * El change se computa desde previousClose para paridad con getQuote().
 */
export function parseV7Quote(raw: RawV7Quote, now: number): Price | null {
  const current = raw.regularMarketPrice;
  if (current == null || !Number.isFinite(current)) return null;

  const previousClose = raw.regularMarketPreviousClose ?? current;
  const change = current - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    symbol: raw.symbol,
    open: raw.regularMarketOpen ?? current,
    current,
    high: raw.regularMarketDayHigh ?? current,
    low: raw.regularMarketDayLow ?? current,
    previousClose,
    change,
    changePercent,
    timestamp: now,
    marketState: raw.marketState,
  };
}

/** Trae quotes en lote vía v7/quote (chunked). Devuelve solo los que Yahoo resolvió. */
export async function getQuotesBatch(symbols: string[], chunkSize?: number): Promise<Price[]> {
  if (symbols.length === 0) return [];

  const auth = await ensureCrumb();
  if (!auth) {
    // Sin crumb no hay endpoint batch; el caller decide el fallback.
    throw new Error('Yahoo batch quotes: sin crumb/cookie');
  }

  const now = Date.now();
  // Yahoo throttlea (503) intermitentemente en v7/quote; menos requests = menos exposición.
  // El tope se lee lazy (landmine env). Los 503 se reintentan DENTRO de withRetry.
  const size = chunkSize ?? envNumber('YAHOO_QUOTE_CHUNK', 30);
  const chunks = chunkSymbols(symbols, size);
  const perChunk = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const url =
        `https://query1.finance.yahoo.com/v7/finance/quote` +
        `?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(auth.crumb)}`;
      const data = await withRetry(
        async () => {
          const res = await yfetch(url, { headers: { ...YAHOO_HEADERS, Cookie: auth.cookie } });
          if (res.status === 401) {
            yahooCrumb = null;
            yahooCookie = null;
          }
          // Tirar acá (no afuera) para que withRetry reintente los 503/5xx transitorios.
          if (!res.ok) throw new Error(`Yahoo batch HTTP ${res.status}`);
          return (await res.json()) as YahooV7QuoteResponse;
        },
        `Yahoo:batch(${chunk.length})`,
        { maxRetries: 3, baseDelayMs: 800 },
      );
      return data.quoteResponse?.result ?? [];
    }),
  );

  const prices: Price[] = [];
  for (const r of perChunk) {
    if (r.status === 'fulfilled') {
      for (const raw of r.value) {
        const p = parseV7Quote(raw, now);
        if (p) prices.push(p);
      }
    } else {
      console.warn('[Yahoo] Batch chunk falló:', r.reason?.message);
    }
  }

  if (prices.length > 0) reportOk(SVC_PRICES);
  return prices;
}

export async function getQuotes(symbols: string[]): Promise<Price[]> {
  if (symbols.length === 0) return [];

  // 1. Intento en lote (pocos requests). Si el batch entero falla (sin crumb, etc.),
  //    caemos al fan-out per-símbolo para no perder toda la data.
  let batched: Price[] = [];
  try {
    batched = await getQuotesBatch(symbols);
  } catch (err) {
    console.warn('[Yahoo] Batch no disponible, fallback per-símbolo:', (err as Error).message);
  }

  const got = new Set(batched.map((p) => p.symbol));
  const missing = symbols.filter((s) => !got.has(s));
  if (missing.length === 0) return batched;

  // 2. Fallback acotado solo para los símbolos que el batch no resolvió.
  const results = await Promise.allSettled(missing.map((s) => getQuote(s)));
  for (const r of results) {
    if (r.status === 'fulfilled') {
      batched.push(r.value);
    } else {
      console.warn(`[Yahoo] Failed:`, r.reason?.message);
    }
  }

  return batched;
}

// --- Historical OHLC data ---

export async function getHistoricalQuotes(
  symbol: string,
  range: string = '6mo',
  interval: string = '1d',
  opts?: { priority?: boolean },
): Promise<OHLC[]> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await yfetch(url, { headers: YAHOO_HEADERS }, opts);

  if (!res.ok) {
    throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol} (historical)`);
  }

  const data = (await res.json()) as YahooResponse;

  if (!data.chart.result || data.chart.result.length === 0) {
    throw new Error(`No historical data for ${symbol}`);
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp ?? [];
  const q = result.indicators.quote[0];
  // Split/dividend-adjusted closes correct reverse-split poison (e.g. pre-split $200 alongside $9).
  const adj = result.indicators.adjclose?.[0]?.adjclose;

  const ohlc: OHLC[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = q.open[i];
    const high = q.high[i];
    const low = q.low[i];
    const close = q.close[i];
    const volume = q.volume?.[i];

    // Skip entries with null values (holidays/gaps)
    if (open == null || high == null || low == null || close == null) continue;

    // When adjusted close is present and sane, scale the whole candle by adjclose/close so
    // OHLC stays internally consistent and splits are corrected at the source.
    const adjClose = adj?.[i];
    const factor = (adjClose != null && Number.isFinite(adjClose) && close > 0)
      ? adjClose / close : 1;

    ohlc.push({
      // For intraday intervals keep full ISO datetime, for daily+ keep date only
      date: interval.includes('m') || interval.includes('h')
        ? new Date(timestamps[i] * 1000).toISOString()
        : new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: open * factor,
      high: high * factor,
      low: low * factor,
      close: close * factor,
      volume: volume ?? 0,
    });
  }

  return ohlc;
}

// --- Symbol search ---

interface YahooSearchResult {
  quotes: Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    quoteType: string;
    exchange: string;
    exchDisp?: string;
    isYahooFinance: boolean;
  }>;
}

function inferTypeAndFlag(quoteType: string, exchange: string): { type: 'adr' | 'us' | 'crypto'; flag: string } {
  if (quoteType === 'CRYPTOCURRENCY') return { type: 'crypto', flag: '🌐' };
  if (/^(BUE|BA|BCBA)$/i.test(exchange)) return { type: 'adr', flag: '🇦🇷' };
  return { type: 'us', flag: '🇺🇸' };
}

export async function searchSymbols(query: string): Promise<Array<{
  symbol: string;
  name: string;
  type: 'adr' | 'us' | 'crypto';
  exchange: string;
  flag: string;
}>> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  const res = await yfetch(url, { headers: YAHOO_HEADERS });

  if (!res.ok) return [];

  const data = (await res.json()) as YahooSearchResult;
  return (data.quotes ?? [])
    .filter((q) => q.isYahooFinance)
    .map((q) => {
      const { type, flag } = inferTypeAndFlag(q.quoteType, q.exchange);
      return {
        symbol: q.symbol,
        name: q.longname ?? q.shortname ?? q.symbol,
        type,
        exchange: q.exchDisp ?? q.exchange,
        flag,
      };
    });
}

// --- Yahoo crumb + cookie auth ---

let yahooCrumb: string | null = null;
let yahooCookie: string | null = null;
let crumbFetchedAt = 0;
const CRUMB_TTL = 30 * 60 * 1000; // 30 minutes

async function ensureCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (yahooCrumb && yahooCookie && Date.now() - crumbFetchedAt < CRUMB_TTL) {
    return { crumb: yahooCrumb, cookie: yahooCookie };
  }

  try {
    // Step 1: Get cookie from Yahoo consent page
    const consentRes = await yfetch('https://fc.yahoo.com', {
      headers: YAHOO_HEADERS,
      redirect: 'manual',
    });
    const setCookie = consentRes.headers.get('set-cookie');
    const cookie = setCookie?.split(';')[0] ?? '';

    if (!cookie) {
      console.warn('[Yahoo] No cookie received from fc.yahoo.com');
      return null;
    }

    // Step 2: Get crumb using the cookie
    const crumbRes = await yfetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...YAHOO_HEADERS, Cookie: cookie },
    });

    if (!crumbRes.ok) {
      console.warn('[Yahoo] Crumb fetch failed:', crumbRes.status);
      return null;
    }

    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<')) {
      console.warn('[Yahoo] Invalid crumb response');
      return null;
    }

    yahooCrumb = crumb;
    yahooCookie = cookie;
    crumbFetchedAt = Date.now();
    console.log('[Yahoo] Crumb obtained successfully');
    return { crumb, cookie };
  } catch (err) {
    console.warn('[Yahoo] Crumb auth failed:', (err as Error).message);
    return null;
  }
}

// --- Fundamental data ---

interface YahooQuoteSummary {
  quoteSummary: {
    result: Array<{
      defaultKeyStatistics?: Record<string, { raw?: number }>;
      financialData?: Record<string, { raw?: number }>;
      summaryDetail?: Record<string, { raw?: number }>;
      incomeStatementHistory?: {
        incomeStatementHistory?: Array<Record<string, { raw?: number }>>;
      };
      balanceSheetHistory?: {
        balanceSheetStatements?: Array<Record<string, { raw?: number }>>;
      };
      cashflowStatementHistory?: {
        cashflowStatements?: Array<Record<string, { raw?: number }>>;
      };
      earningsTrend?: {
        trend?: Array<{
          earningsEstimate?: { avg?: { raw?: number } };
        }>;
      };
      calendarEvents?: {
        earnings?: {
          earningsDate?: Array<{ raw?: number }>;
        };
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

function extractRaw(obj: Record<string, { raw?: number }> | undefined, key: string): number | null {
  const val = obj?.[key]?.raw;
  return val != null && isFinite(val) ? val : null;
}

function parseFundamentalsFromSummary(
  symbol: string,
  result: NonNullable<YahooQuoteSummary['quoteSummary']['result']>[0],
): FundamentalData | null {
  const stats = result.defaultKeyStatistics;
  const fin = result.financialData;
  const summary = result.summaryDetail;

  const currentPrice = extractRaw(fin, 'currentPrice') ?? extractRaw(summary, 'previousClose') ?? 0;
  const high52 = extractRaw(summary, 'fiftyTwoWeekHigh');
  const low52 = extractRaw(summary, 'fiftyTwoWeekLow');

  // Extract financial statement data if available
  const income = result.incomeStatementHistory?.incomeStatementHistory?.[0];
  const prevIncome = result.incomeStatementHistory?.incomeStatementHistory?.[1];
  const balance = result.balanceSheetHistory?.balanceSheetStatements?.[0];
  const cashflow = result.cashflowStatementHistory?.cashflowStatements?.[0];
  const earningsTrend = result.earningsTrend?.trend?.[0];

  // Revenue growth YoY
  const revenue = extractRaw(income, 'totalRevenue');
  const prevRevenue = extractRaw(prevIncome, 'totalRevenue');
  const revenueGrowth = revenue && prevRevenue && prevRevenue > 0
    ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

  // Margins
  const grossProfit = extractRaw(income, 'grossProfit');
  const operatingIncome = extractRaw(income, 'operatingIncome');
  const netIncome = extractRaw(income, 'netIncome');
  const grossMargin = revenue && grossProfit ? (grossProfit / revenue) * 100 : null;
  const operatingMargin = revenue && operatingIncome ? (operatingIncome / revenue) * 100 : null;
  const netMargin = revenue && netIncome ? (netIncome / revenue) * 100 : null;

  // Balance sheet
  const totalDebt = extractRaw(balance, 'longTermDebt') ?? extractRaw(balance, 'totalDebt');
  const totalEquity = extractRaw(balance, 'totalStockholderEquity');
  const debtToEquity = totalDebt != null && totalEquity && totalEquity > 0
    ? totalDebt / totalEquity : null;

  // Cash flow
  const freeCashFlow = extractRaw(cashflow, 'freeCashFlow')
    ?? extractRaw(cashflow, 'totalCashFromOperatingActivities');

  // ROE / ROA
  const totalAssets = extractRaw(balance, 'totalAssets');
  const returnOnEquity = netIncome && totalEquity && totalEquity > 0
    ? (netIncome / totalEquity) * 100 : null;
  const returnOnAssets = netIncome && totalAssets && totalAssets > 0
    ? (netIncome / totalAssets) * 100 : null;

  // Earnings surprise
  const earningsSurprise = earningsTrend?.earningsEstimate?.avg?.raw != null && extractRaw(stats, 'trailingEps') != null
    ? ((extractRaw(stats, 'trailingEps')! - earningsTrend.earningsEstimate.avg.raw) / Math.abs(earningsTrend.earningsEstimate.avg.raw)) * 100
    : null;

  return {
    symbol,
    marketCap: extractRaw(summary, 'marketCap'),
    peRatio: extractRaw(summary, 'trailingPE'),
    forwardPE: extractRaw(stats, 'forwardPE') ?? extractRaw(summary, 'forwardPE'),
    // Yahoo deprecó pegRatio clásico; trailingPegRatio es el campo vigente. Ambos por las dudas.
    pegRatio: extractRaw(stats, 'trailingPegRatio') ?? extractRaw(stats, 'pegRatio'),
    eps: extractRaw(stats, 'trailingEps'),
    dividendYield: extractRaw(summary, 'dividendYield'),
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    currentPrice,
    priceVs52wHigh: high52 && currentPrice ? ((currentPrice - high52) / high52) * 100 : null,
    priceVs52wLow: low52 && currentPrice ? ((currentPrice - low52) / low52) * 100 : null,
    avgVolume: extractRaw(summary, 'averageVolume') ?? extractRaw(stats, 'averageVolume'),
    beta: extractRaw(stats, 'beta'),
    revenueGrowth: revenueGrowth != null ? Math.round(revenueGrowth * 100) / 100 : null,
    grossMargin: grossMargin != null ? Math.round(grossMargin * 100) / 100 : null,
    operatingMargin: operatingMargin != null ? Math.round(operatingMargin * 100) / 100 : null,
    netMargin: netMargin != null ? Math.round(netMargin * 100) / 100 : null,
    debtToEquity: debtToEquity != null ? Math.round(debtToEquity * 100) / 100 : null,
    freeCashFlow: freeCashFlow != null ? Math.round(freeCashFlow) : null,
    returnOnEquity: returnOnEquity != null ? Math.round(returnOnEquity * 100) / 100 : null,
    returnOnAssets: returnOnAssets != null ? Math.round(returnOnAssets * 100) / 100 : null,
    earningsSurprise: earningsSurprise != null ? Math.round(earningsSurprise * 100) / 100 : null,
    nextEarningsDate: (() => {
      const earningsTimestamp = result.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
      if (earningsTimestamp) {
        return new Date(earningsTimestamp * 1000).toISOString().split('T')[0];
      }
      return null;
    })()
  };
}

export async function getFundamentals(symbol: string, opts?: { priority?: boolean }): Promise<FundamentalData> {
  const modules = 'defaultKeyStatistics,financialData,summaryDetail,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,earningsTrend,calendarEvents';

  // Try with crumb auth first
  const auth = await ensureCrumb();
  if (auth) {
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
      const res = await yfetch(url, {
        headers: { ...YAHOO_HEADERS, Cookie: auth.cookie },
      }, opts);

      if (res.ok) {
        const data = (await res.json()) as YahooQuoteSummary;
        const result = data.quoteSummary?.result?.[0];
        if (result) {
          const parsed = parseFundamentalsFromSummary(symbol, result);
          if (parsed) {
            reportOk(SVC_FUNDAMENTALS);
            return parsed;
          }
        }
      } else if (res.status === 401) {
        yahooCrumb = null;
        yahooCookie = null;
        crumbFetchedAt = 0;
        reportError(SVC_FUNDAMENTALS, `Crumb expirado (401) para ${symbol}`);
      }
    } catch (err) {
      console.warn(`[Yahoo] quoteSummary with crumb failed for ${symbol}:`, (err as Error).message);
      reportError(SVC_FUNDAMENTALS, `Error de red para ${symbol}: ${(err as Error).message.slice(0, 100)}`);
    }
  } else {
    reportError(SVC_FUNDAMENTALS, 'No se pudo obtener crumb de Yahoo (autenticacion fallida)');
  }

  // Fallback: try without auth (may work for some endpoints)
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    const res = await yfetch(url, { headers: YAHOO_HEADERS }, opts);
    if (res.ok) {
      const data = (await res.json()) as YahooQuoteSummary;
      const result = data.quoteSummary?.result?.[0];
      if (result) {
        const parsed = parseFundamentalsFromSummary(symbol, result);
        if (parsed) {
          reportOk(SVC_FUNDAMENTALS);
          return parsed;
        }
      }
    }
  } catch {
    // ignore — fallback below
  }

  // Final fallback: chart endpoint (no P/E, EPS, dividends)
  reportError(SVC_FUNDAMENTALS, `Sin datos fundamentales para ${symbol} — usando solo datos de precio`);
  return getFundamentalsFromChart(symbol);
}

async function getFundamentalsFromChart(symbol: string): Promise<FundamentalData> {
  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await yfetch(url, { headers: YAHOO_HEADERS });
    const data = (await res.json()) as YahooResponse;
    const meta = data.chart.result?.[0]?.meta;

    if (meta) {
      const currentPrice = meta.regularMarketPrice;
      const high52 = meta.fiftyTwoWeekHigh ?? null;
      const low52 = meta.fiftyTwoWeekLow ?? null;

      return {
        symbol,
        marketCap: null,
        peRatio: null,
        forwardPE: null,
        pegRatio: null,
        eps: null,
        dividendYield: null,
        fiftyTwoWeekHigh: high52,
        fiftyTwoWeekLow: low52,
        currentPrice,
        priceVs52wHigh: high52 ? ((currentPrice - high52) / high52) * 100 : null,
        priceVs52wLow: low52 ? ((currentPrice - low52) / low52) * 100 : null,
        avgVolume: meta.averageDailyVolume10Day ?? null,
        beta: null,
        ...EMPTY_EXTENDED_FUNDAMENTALS,
      };
    }
  } catch {
    // ignore
  }

  return {
    symbol, marketCap: null, peRatio: null, forwardPE: null, pegRatio: null, eps: null,
    dividendYield: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
    currentPrice: 0, priceVs52wHigh: null, priceVs52wLow: null,
    avgVolume: null, beta: null,
    ...EMPTY_EXTENDED_FUNDAMENTALS,
  };
}

// --- Asset Profile (sector, industry, quoteType, exchange) ---

export interface YahooAssetProfile {
  quoteType: string;    // EQUITY, ETF, CRYPTOCURRENCY, MUTUALFUND
  exchange: string;     // NMS, NYQ, BUE
  sector: string | null;
  industry: string | null;
  longName: string;
}

export async function getAssetProfile(symbol: string): Promise<YahooAssetProfile | null> {
  const modules = 'assetProfile,quoteType';
  const auth = await ensureCrumb();

  const tryFetch = async (baseUrl: string, headers: Record<string, string>): Promise<YahooAssetProfile | null> => {
    try {
      const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : ''}`;
      const res = await yfetch(url, { headers });
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const result = data.quoteSummary?.result?.[0];
      if (!result) return null;

      const profile = result.assetProfile ?? {};
      const qt = result.quoteType ?? {};

      return {
        quoteType: qt.quoteType ?? 'EQUITY',
        exchange: qt.exchange ?? '',
        sector: profile.sector ?? null,
        industry: profile.industry ?? null,
        longName: qt.longName ?? profile.companyName ?? symbol,
      };
    } catch {
      return null;
    }
  };

  // Try authenticated first, then unauthenticated
  if (auth) {
    const result = await tryFetch('https://query2.finance.yahoo.com', { ...YAHOO_HEADERS, Cookie: auth.cookie });
    if (result) return result;
  }

  return tryFetch('https://query1.finance.yahoo.com', YAHOO_HEADERS);
}

// --- Earnings History (for PEAD signal) ---

export interface EarningsHistoryEntry {
  epsActual: number | null;
  epsEstimate: number | null;
  epsDifference: number | null;
  surprisePercent: number | null;
  quarter: string | null; // YYYY-MM-DD
  period: string | null;
}

export async function getEarningsHistory(symbol: string): Promise<EarningsHistoryEntry[]> {
  const modules = 'earningsHistory';
  const auth = await ensureCrumb();

  const tryFetch = async (baseUrl: string, headers: Record<string, string>): Promise<EarningsHistoryEntry[] | null> => {
    try {
      const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
      const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${crumbParam}`;
      const res = await yfetch(url, { headers });
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const history = data?.quoteSummary?.result?.[0]?.earningsHistory?.history;
      if (!Array.isArray(history)) return null;

      return history.map((h: any) => ({
        epsActual: h?.epsActual?.raw ?? null,
        epsEstimate: h?.epsEstimate?.raw ?? null,
        epsDifference: h?.epsDifference?.raw ?? null,
        surprisePercent: h?.surprisePercent?.raw ?? null,
        quarter: h?.quarter?.raw ? new Date(h.quarter.raw * 1000).toISOString().split('T')[0] : null,
        period: h?.period ?? null,
      }));
    } catch {
      return null;
    }
  };

  if (auth) {
    const result = await tryFetch('https://query2.finance.yahoo.com', { ...YAHOO_HEADERS, Cookie: auth.cookie });
    if (result) return result;
  }
  const result = await tryFetch('https://query1.finance.yahoo.com', YAHOO_HEADERS);
  return result ?? [];
}

// --- Insider Transactions (for Insider Buying signal) ---

export interface YahooInsiderTransaction {
  filerName: string;
  relation: string;
  transactionText: string;
  startDate: string | null; // YYYY-MM-DD
  value: number | null;
}

export async function getInsiderTransactions(symbol: string): Promise<YahooInsiderTransaction[]> {
  const modules = 'insiderTransactions';
  const auth = await ensureCrumb();

  const tryFetch = async (baseUrl: string, headers: Record<string, string>): Promise<YahooInsiderTransaction[] | null> => {
    try {
      const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
      const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${crumbParam}`;
      const res = await yfetch(url, { headers });
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const transactions = data?.quoteSummary?.result?.[0]?.insiderTransactions?.transactions;
      if (!Array.isArray(transactions)) return null;

      return transactions.map((t: any) => ({
        filerName: t?.filerName ?? '',
        relation: t?.relation ?? '',
        transactionText: t?.transactionText ?? '',
        startDate: t?.startDate?.raw ? new Date(t.startDate.raw * 1000).toISOString().split('T')[0] : null,
        value: t?.value?.raw ?? null,
      }));
    } catch {
      return null;
    }
  };

  if (auth) {
    const result = await tryFetch('https://query2.finance.yahoo.com', { ...YAHOO_HEADERS, Cookie: auth.cookie });
    if (result) return result;
  }
  const result = await tryFetch('https://query1.finance.yahoo.com', YAHOO_HEADERS);
  return result ?? [];
}

// --- Key Statistics (para sharesOutstanding, insumo del Radar de Ciclos) ---

/**
 * sharesOutstanding y totalAssets vía quoteSummary/defaultKeyStatistics.
 * Para ETFs, Yahoo casi nunca publica sharesOutstanding (solo algunos emisores lo hacen);
 * totalAssets (AUM) sí está en el mismo módulo para todos y sirve de sustituto
 * (AUM/precio = shares implícitas, ver cycle-radar.service.ts).
 * Fail-closed: cualquier error o dato faltante => null (el radar lo trata como "sin dato").
 */
export async function getKeyStats(symbol: string): Promise<{ sharesOutstanding: number | null; totalAssets: number | null }> {
  const EMPTY = { sharesOutstanding: null, totalAssets: null };
  try {
    const modules = 'defaultKeyStatistics';
    const auth = await ensureCrumb();

    const tryFetch = async (baseUrl: string, headers: Record<string, string>): Promise<{ sharesOutstanding: number | null; totalAssets: number | null } | null> => {
      try {
        const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
        const url = `${baseUrl}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${crumbParam}`;
        const res = await yfetch(url, { headers });
        if (!res.ok) return null;

        const data = (await res.json()) as any;
        const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
        if (!stats) return null;

        const rawShares = extractRaw(stats, 'sharesOutstanding');
        const rawAssets = extractRaw(stats, 'totalAssets');
        return {
          sharesOutstanding: rawShares != null && rawShares > 0 ? rawShares : null,
          totalAssets: rawAssets != null && rawAssets > 0 ? rawAssets : null,
        };
      } catch {
        return null;
      }
    };

    if (auth) {
      const result = await tryFetch('https://query2.finance.yahoo.com', { ...YAHOO_HEADERS, Cookie: auth.cookie });
      if (result) return result;
    }
    const result = await tryFetch('https://query1.finance.yahoo.com', YAHOO_HEADERS);
    return result ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

// --- Options Chain (for Options Flow signal) ---

export interface OptionsContract {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

export interface OptionsExpiryData {
  expirationDate: string; // YYYY-MM-DD
  calls: OptionsContract[];
  puts: OptionsContract[];
}

export async function getOptionsChain(symbol: string): Promise<OptionsExpiryData[]> {
  const auth = await ensureCrumb();

  const tryFetch = async (baseUrl: string, headers: Record<string, string>): Promise<OptionsExpiryData[] | null> => {
    try {
      const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : '';
      const url = `${baseUrl}/v7/finance/options/${encodeURIComponent(symbol)}?straddle=false${crumbParam}`;
      const res = await yfetch(url, { headers });
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const optionsList = data?.optionChain?.result?.[0]?.options;
      if (!Array.isArray(optionsList)) return null;

      const parseContracts = (contracts: any[]): OptionsContract[] =>
        contracts.map((c: any) => ({
          contractSymbol: c.contractSymbol ?? '',
          strike: c.strike ?? 0,
          lastPrice: c.lastPrice ?? 0,
          volume: c.volume ?? null,
          openInterest: c.openInterest ?? null,
          impliedVolatility: c.impliedVolatility ?? null,
        }));

      return optionsList.map((opt: any) => ({
        expirationDate: opt.expirationDate
          ? new Date(opt.expirationDate * 1000).toISOString().split('T')[0]
          : '',
        calls: parseContracts(opt.calls ?? []),
        puts: parseContracts(opt.puts ?? []),
      }));
    } catch {
      return null;
    }
  };

  if (auth) {
    const result = await tryFetch('https://query2.finance.yahoo.com', { ...YAHOO_HEADERS, Cookie: auth.cookie });
    if (result) return result;
  }
  const result = await tryFetch('https://query1.finance.yahoo.com', YAHOO_HEADERS);
  return result ?? [];
}
