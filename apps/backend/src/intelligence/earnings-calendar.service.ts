import { getActiveSymbolList } from '../db/repository.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getApiKey(): string | undefined {
  return process.env.FINNHUB_API_KEY;
}

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface FinnhubEarning {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
  hour: string; // 'bmo' | 'amc' | 'dmh'
}

interface FinnhubRecommendation {
  symbol: string;
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
}

async function fetchEarningsCalendar(from: string, to: string, apiKey: string): Promise<FinnhubEarning[]> {
  const url = `${FINNHUB_BASE}/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { earningsCalendar?: FinnhubEarning[] };
    return data.earningsCalendar ?? [];
  } catch {
    return [];
  }
}

async function fetchRecommendation(symbol: string, apiKey: string): Promise<FinnhubRecommendation | null> {
  const url = `${FINNHUB_BASE}/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as FinnhubRecommendation[];
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export interface EarningsContext {
  upcomingEarnings: Array<{
    symbol: string;
    date: string;
    daysUntil: number;
    epsEstimate: number | null;
    hour: string;
    consensus: { buy: number; hold: number; sell: number } | null;
  }>;
  formattedBlock: string;
}

export async function getEarningsContext(daysAhead = 10): Promise<EarningsContext> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { upcomingEarnings: [], formattedBlock: '' };
  }

  const trackedSymbols = new Set(
    getActiveSymbolList().filter(s => !s.includes('-') && !s.includes('USD'))
  );

  const from = dateStr(0);
  const to = dateStr(daysAhead);
  const allEarnings = await fetchEarningsCalendar(from, to, apiKey);

  // Filter to only symbols we track
  const relevant = allEarnings.filter(e => trackedSymbols.has(e.symbol));

  if (relevant.length === 0) {
    return { upcomingEarnings: [], formattedBlock: '' };
  }

  // Fetch analyst recommendations in parallel for relevant symbols (max 10)
  const symbolsForRecs = relevant.slice(0, 10).map(e => e.symbol);
  const recResults = await Promise.allSettled(
    symbolsForRecs.map(s => fetchRecommendation(s, apiKey))
  );
  const recMap = new Map<string, FinnhubRecommendation>();
  symbolsForRecs.forEach((s, i) => {
    const r = recResults[i];
    if (r.status === 'fulfilled' && r.value) recMap.set(s, r.value);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingEarnings = relevant.map(e => {
    const earningDate = new Date(e.date);
    earningDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((earningDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const rec = recMap.get(e.symbol);
    return {
      symbol: e.symbol,
      date: e.date,
      daysUntil,
      epsEstimate: e.epsEstimate,
      hour: e.hour,
      consensus: rec ? { buy: rec.buy + rec.strongBuy, hold: rec.hold, sell: rec.sell + rec.strongSell } : null,
    };
  }).sort((a, b) => a.daysUntil - b.daysUntil);

  const hourLabel: Record<string, string> = { bmo: 'antes apertura', amc: 'después cierre', dmh: 'durante sesión' };

  const lines = upcomingEarnings.map(e => {
    const when = e.daysUntil === 0 ? 'HOY' : e.daysUntil === 1 ? 'MAÑANA' : `en ${e.daysUntil}d`;
    const eps = e.epsEstimate != null ? ` | EPS est: $${e.epsEstimate.toFixed(2)}` : '';
    const consensus = e.consensus
      ? ` | Analistas: ${e.consensus.buy}↑ ${e.consensus.hold}= ${e.consensus.sell}↓`
      : '';
    const timing = hourLabel[e.hour] ?? e.hour;
    return `- ${e.symbol}: reporta ${e.date} (${when}, ${timing})${eps}${consensus}`;
  });

  const formattedBlock = lines.length > 0
    ? `EARNINGS PRÓXIMOS ${daysAhead} DÍAS:\n${lines.join('\n')}`
    : '';

  console.log(`[EarningsCalendar] ${upcomingEarnings.length} earnings encontrados para símbolos tracked`);
  return { upcomingEarnings, formattedBlock };
}
