import type { MarketMovers, TopMover } from '@trading/shared';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const TOP_N = 5;

let cached: MarketMovers | null = null;
let lastFetch = 0;

interface FMPMover {
  symbol: string;
  name: string;
  change: number;
  price: number;
  changesPercentage: number;
}

function mapMover(m: FMPMover): TopMover {
  return {
    symbol: m.symbol,
    name: m.name,
    price: m.price,
    change: m.change,
    changePercent: m.changesPercentage,
  };
}

export async function getMarketMovers(): Promise<MarketMovers> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return { gainers: [], losers: [] };
  }

  const now = Date.now();
  if (cached && now - lastFetch < CACHE_TTL) {
    return cached;
  }

  try {
    const [gainersRes, losersRes] = await Promise.all([
      fetch(`${FMP_BASE}/stock_market/gainers?apikey=${apiKey}`),
      fetch(`${FMP_BASE}/stock_market/losers?apikey=${apiKey}`),
    ]);

    if (!gainersRes.ok || !losersRes.ok) {
      console.error('[FMP] Error fetching market movers:', gainersRes.status, losersRes.status);
      return cached ?? { gainers: [], losers: [] };
    }

    const gainersData = (await gainersRes.json()) as FMPMover[];
    const losersData = (await losersRes.json()) as FMPMover[];

    cached = {
      gainers: gainersData.slice(0, TOP_N).map(mapMover),
      losers: losersData.slice(0, TOP_N).map(mapMover),
    };
    lastFetch = now;

    return cached;
  } catch (err) {
    console.error('[FMP] Network error:', err);
    return cached ?? { gainers: [], losers: [] };
  }
}
