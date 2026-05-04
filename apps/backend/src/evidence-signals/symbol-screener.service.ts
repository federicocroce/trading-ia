/**
 * Dynamic symbol universe for evidence signals scanning.
 * Sources: curated liquid US stocks + NASDAQ earnings calendar + SEC EDGAR Form 4 + portfolio.
 *
 * Also provides peadOverrides: NASDAQ-sourced EPS beat data that replaces Yahoo Finance's
 * often-incorrect surprisePercent for PEAD signal calculation.
 */

import { getEtfSymbols } from '../db/repository.js';

const EDGAR_HEADERS = { 'User-Agent': 'trading-dashboard/1.0 (federico@mundi.io)' };
const NASDAQ_HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

const SCREENER_CACHE_MS = 6 * 60 * 60 * 1000; // 6h

let cachedUniverse: string[] | null = null;
let universeExpiresAt = 0;
let cachedPeadOverrides: Map<string, PeadOverride> = new Map();

// CIK → ticker lookup, cached for process lifetime
let cikTickerMap: Map<number, string> | null = null;

/** NASDAQ-sourced PEAD data (more accurate than Yahoo Finance surprisePercent). */
export interface PeadOverride {
  announcementDate: string;  // actual earnings report date (YYYY-MM-DD)
  surprisePct: number;       // EPS beat % vs Wall Street consensus
}

// ~75 liquid US stocks: mega-cap + mid-cap with active options markets,
// quarterly earnings, and reliable insider transaction data on Yahoo Finance.
export const CURATED_US_SYMBOLS: string[] = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'NFLX', 'ORCL', 'CRM', 'NOW',
  'ADBE', 'INTU', 'PANW', 'SNPS', 'CDNS', 'FTNT',
  // Semiconductors
  'AMD', 'INTC', 'QCOM', 'MU', 'AMAT', 'LRCX', 'KLAC', 'AVGO', 'MRVL', 'SMCI', 'ON',
  // Cloud / SaaS (PEAD-rich: frequent beats, active options)
  'DDOG', 'NET', 'CRWD', 'ZS', 'SNOW', 'MDB', 'HUBS', 'TTD', 'TWLO', 'OKTA',
  'VEEV', 'BILL', 'TOST', 'PCTY',
  // Financials
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'AXP', 'BLK', 'SCHW', 'C', 'WFC', 'COF',
  'ICE', 'CME', 'COIN', 'HOOD', 'SOFI',
  // Healthcare / Pharma / MedTech
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE', 'AMGN', 'GILD', 'REGN', 'BMY', 'MRNA',
  'ISRG', 'DXCM', 'EW', 'PODD', 'IDXX', 'HOLX', 'ALGN', 'VRTX', 'INMD',
  // Energy
  'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY', 'HAL', 'VST', 'CEG',
  // Consumer / Retail (PEAD-rich: guidance beats)
  'COST', 'WMT', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'BKNG',
  'CAVA', 'WING', 'ELF', 'LULU', 'DECK', 'ONON', 'SKX',
  // Industrials / Defense / Security
  'CAT', 'BA', 'LMT', 'RTX', 'GE', 'HON', 'UPS', 'FDX', 'DE',
  'AXON', 'TRMB', 'CPRT', 'ODFL', 'GNRC',
  // Telecom / Media
  'T', 'VZ', 'DIS', 'CMCSA', 'PINS', 'SNAP', 'RDDT',
  // Data / AI infrastructure (high growth, active options)
  'PLTR', 'MELI', 'NU', 'SHOP', 'UBER', 'RBLX', 'APP',
  // Materials / Misc
  'FCX', 'NEM', 'MP',
];

// ETFs are tracked separately for options flow only (no PEAD/insider signals)
export function getCuratedEtfSymbols(): string[] {
  return getEtfSymbols();
}

// ─── CIK lookup ─────────────────────────────────────────────────────────────

async function ensureCikTickerMap(): Promise<Map<number, string>> {
  if (cikTickerMap) return cikTickerMap;
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: EDGAR_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return new Map();
    const data = await res.json() as Record<string, { cik_str: number; ticker: string }>;
    const map = new Map<number, string>();
    for (const entry of Object.values(data)) {
      if (entry?.cik_str && entry?.ticker) {
        map.set(entry.cik_str, entry.ticker.toUpperCase());
      }
    }
    cikTickerMap = map;
    console.log(`[Screener] CIK→ticker map loaded: ${map.size} entries`);
    return map;
  } catch {
    return new Map();
  }
}

// ─── NASDAQ earnings calendar ────────────────────────────────────────────────

async function fetchNasdaqEarningsForDate(
  dateStr: string,
): Promise<Array<{ symbol: string; surprisePct: number; date: string }>> {
  try {
    const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
    const res = await fetch(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const rows: unknown[] = (data as any)?.data?.rows ?? [];
    const results: Array<{ symbol: string; surprisePct: number; date: string }> = [];
    for (const row of rows) {
      const r = row as Record<string, string>;
      const symbol = (r.symbol ?? '').trim().toUpperCase();
      if (!symbol || !/^[A-Z]{1,5}$/.test(symbol)) continue;
      const surprisePct = parseFloat(r.surprise ?? '');
      if (!isNaN(surprisePct)) results.push({ symbol, surprisePct, date: dateStr });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Fetches earnings for the last `lookbackDays` business days.
 * Returns:
 *   - beatSymbols: symbols that beat ≥10% (added to scan universe)
 *   - peadMap: all symbols with any surprise data (used to override Yahoo Finance surprise%)
 */
async function fetchEarningsCalendar(lookbackDays = 60): Promise<{
  beatSymbols: string[];
  peadMap: Map<string, PeadOverride>;
}> {
  const dates: string[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    dates.push(d.toISOString().split('T')[0]);
  }

  const allResults = await Promise.allSettled(dates.map((d) => fetchNasdaqEarningsForDate(d)));

  const beatSymbols = new Set<string>();
  const peadMap = new Map<string, PeadOverride>();

  for (const r of allResults) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) {
      // Keep the most recent entry per symbol (dates are iterated newest-first)
      if (!peadMap.has(e.symbol)) {
        peadMap.set(e.symbol, { announcementDate: e.date, surprisePct: e.surprisePct });
      }
      if (e.surprisePct >= 10) beatSymbols.add(e.symbol);
    }
  }

  console.log(`[Screener] NASDAQ earnings (last ${lookbackDays}d): ${peadMap.size} companies, ${beatSymbols.size} beats ≥10%`);
  return { beatSymbols: [...beatSymbols], peadMap };
}

// ─── SEC EDGAR Form 4 ────────────────────────────────────────────────────────

async function fetchEdgarInsiderSymbols(): Promise<string[]> {
  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [cikMap, eftsRes] = await Promise.all([
      ensureCikTickerMap(),
      fetch(
        `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${startDate}&enddt=${endDate}`,
        { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(10000) },
      ),
    ]);

    if (!eftsRes.ok) return [];

    const data = await eftsRes.json() as Record<string, unknown>;
    const hits: unknown[] = (data as any)?.hits?.hits ?? [];

    const tickers = new Set<string>();
    for (const hit of hits) {
      const ciks: unknown[] = (hit as any)?._source?.ciks ?? [];
      for (const rawCik of ciks) {
        const cikNum = parseInt(String(rawCik), 10);
        if (isNaN(cikNum)) continue;
        const ticker = cikMap.get(cikNum);
        if (ticker && /^[A-Z]{1,5}$/.test(ticker)) tickers.add(ticker);
      }
    }

    const found = [...tickers];
    console.log(`[Screener] EDGAR Form 4 (${startDate}→${endDate}): ${found.length} tickers`);
    return found;
  } catch {
    return [];
  }
}

// ─── Main screener ───────────────────────────────────────────────────────────

export async function getScreenedSymbols(portfolioSymbols: string[]): Promise<{
  symbols: string[];
  peadOverrides: Map<string, PeadOverride>;
}> {
  if (cachedUniverse && Date.now() < universeExpiresAt) {
    const combined = new Set([...cachedUniverse, ...portfolioSymbols]);
    return { symbols: [...combined], peadOverrides: cachedPeadOverrides };
  }

  console.log('[Screener] Building dynamic symbol universe...');

  const [earningsResult, edgarResult] = await Promise.allSettled([
    fetchEarningsCalendar(),
    fetchEdgarInsiderSymbols(),
  ]);

  const earnings = earningsResult.status === 'fulfilled'
    ? earningsResult.value
    : { beatSymbols: [], peadMap: new Map<string, PeadOverride>() };
  const edgar = edgarResult.status === 'fulfilled' ? edgarResult.value : [];

  const universe = new Set<string>([
    ...CURATED_US_SYMBOLS,
    ...earnings.beatSymbols,
    ...edgar,
  ]);
  for (const s of universe) {
    if (!/^[A-Z]{1,5}$/.test(s)) universe.delete(s);
  }

  cachedUniverse = [...universe];
  cachedPeadOverrides = earnings.peadMap;
  universeExpiresAt = Date.now() + SCREENER_CACHE_MS;

  const total = new Set([...cachedUniverse, ...portfolioSymbols]);
  console.log(`[Screener] Universe ready: ${cachedUniverse.length} (curated+dynamic) + ${portfolioSymbols.length} portfolio = ${total.size} unique`);
  return { symbols: [...total], peadOverrides: cachedPeadOverrides };
}

export function invalidateScreenerCache(): void {
  cachedUniverse = null;
  universeExpiresAt = 0;
  cachedPeadOverrides = new Map();
}

/** Returns the cached PEAD overrides without rebuilding the universe. */
export function getPeadOverrides(): Map<string, PeadOverride> {
  return cachedPeadOverrides;
}
