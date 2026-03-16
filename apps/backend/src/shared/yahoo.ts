import type { Price, OHLC, FundamentalData } from '@trading/shared';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice: number;
    previousClose: number;
    chartPreviousClose: number;
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
  };
}

interface YahooResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}

export async function getQuote(symbol: string): Promise<Price> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

  const res = await fetch(url, { headers: YAHOO_HEADERS });

  if (!res.ok) {
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
  };
}

export async function getQuotes(symbols: string[]): Promise<Price[]> {
  const results = await Promise.allSettled(
    symbols.map((s) => getQuote(s))
  );

  const prices: Price[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      prices.push(r.value);
    } else {
      console.warn(`[Yahoo] Failed:`, r.reason?.message);
    }
  }

  return prices;
}

// --- Historical OHLC data ---

export async function getHistoricalQuotes(
  symbol: string,
  range: string = '6mo',
  interval: string = '1d',
): Promise<OHLC[]> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });

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

  const ohlc: OHLC[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = q.open[i];
    const high = q.high[i];
    const low = q.low[i];
    const close = q.close[i];
    const volume = q.volume?.[i];

    // Skip entries with null values (holidays/gaps)
    if (open == null || high == null || low == null || close == null) continue;

    ohlc.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open,
      high,
      low,
      close,
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
  const res = await fetch(url, { headers: YAHOO_HEADERS });

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

// --- Fundamental data ---

interface YahooQuoteSummary {
  quoteSummary: {
    result: Array<{
      defaultKeyStatistics?: Record<string, { raw?: number }>;
      financialData?: Record<string, { raw?: number }>;
      summaryDetail?: Record<string, { raw?: number }>;
    }> | null;
    error: { code: string; description: string } | null;
  };
}

function extractRaw(obj: Record<string, { raw?: number }> | undefined, key: string): number | null {
  const val = obj?.[key]?.raw;
  return val != null && isFinite(val) ? val : null;
}

export async function getFundamentals(symbol: string): Promise<FundamentalData> {
  const modules = 'defaultKeyStatistics,financialData,summaryDetail';
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });

    if (res.ok) {
      const data = (await res.json()) as YahooQuoteSummary;
      const result = data.quoteSummary?.result?.[0];

      if (result) {
        const stats = result.defaultKeyStatistics;
        const fin = result.financialData;
        const summary = result.summaryDetail;

        const currentPrice = extractRaw(fin, 'currentPrice') ?? extractRaw(summary, 'previousClose') ?? 0;
        const high52 = extractRaw(summary, 'fiftyTwoWeekHigh');
        const low52 = extractRaw(summary, 'fiftyTwoWeekLow');

        return {
          symbol,
          marketCap: extractRaw(summary, 'marketCap'),
          peRatio: extractRaw(summary, 'trailingPE'),
          forwardPE: extractRaw(stats, 'forwardPE') ?? extractRaw(summary, 'forwardPE'),
          eps: extractRaw(stats, 'trailingEps'),
          dividendYield: extractRaw(summary, 'dividendYield'),
          fiftyTwoWeekHigh: high52,
          fiftyTwoWeekLow: low52,
          currentPrice,
          priceVs52wHigh: high52 && currentPrice ? ((currentPrice - high52) / high52) * 100 : null,
          priceVs52wLow: low52 && currentPrice ? ((currentPrice - low52) / low52) * 100 : null,
          avgVolume: extractRaw(summary, 'averageVolume') ?? extractRaw(stats, 'averageVolume'),
          beta: extractRaw(stats, 'beta'),
        };
      }
    }
  } catch (err) {
    console.warn(`[Yahoo] quoteSummary failed for ${symbol}, trying chart fallback:`, (err as Error).message);
  }

  // Fallback: extract what we can from the chart endpoint meta
  return getFundamentalsFromChart(symbol);
}

async function getFundamentalsFromChart(symbol: string): Promise<FundamentalData> {
  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
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
        eps: null,
        dividendYield: null,
        fiftyTwoWeekHigh: high52,
        fiftyTwoWeekLow: low52,
        currentPrice,
        priceVs52wHigh: high52 ? ((currentPrice - high52) / high52) * 100 : null,
        priceVs52wLow: low52 ? ((currentPrice - low52) / low52) * 100 : null,
        avgVolume: meta.averageDailyVolume10Day ?? null,
        beta: null,
      };
    }
  } catch {
    // ignore
  }

  return {
    symbol, marketCap: null, peRatio: null, forwardPE: null, eps: null,
    dividendYield: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
    currentPrice: 0, priceVs52wHigh: null, priceVs52wLow: null,
    avgVolume: null, beta: null,
  };
}
