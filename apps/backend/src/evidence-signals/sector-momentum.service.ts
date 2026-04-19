import { getHistoricalQuotes } from '../shared/yahoo.js';

// Major sector ETFs
const SECTOR_ETFS: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Healthcare',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLI: 'Industrials',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  XLC: 'Communication Services',
};

// Symbol to sector ETF mapping (major US stocks)
const SYMBOL_TO_SECTOR: Record<string, string> = {
  // Technology
  AAPL: 'XLK', MSFT: 'XLK', NVDA: 'XLK', AMD: 'XLK', INTC: 'XLK', QCOM: 'XLK',
  AVGO: 'XLK', TXN: 'XLK', MU: 'XLK', AMAT: 'XLK', KLAC: 'XLK', LRCX: 'XLK',
  ORCL: 'XLK', IBM: 'XLK', HPQ: 'XLK', CSCO: 'XLK', ACN: 'XLK', NOW: 'XLK',
  CRM: 'XLK', ADBE: 'XLK', INTU: 'XLK', PANW: 'XLK', SNPS: 'XLK', CDNS: 'XLK',
  // Communication
  GOOGL: 'XLC', GOOG: 'XLC', META: 'XLC', NFLX: 'XLC', DIS: 'XLC', CMCSA: 'XLC',
  T: 'XLC', VZ: 'XLC', TMUS: 'XLC', SNAP: 'XLC', PINS: 'XLC', MTCH: 'XLC',
  // Consumer Discretionary
  AMZN: 'XLY', TSLA: 'XLY', HD: 'XLY', MCD: 'XLY', SBUX: 'XLY', NKE: 'XLY',
  LOW: 'XLY', TGT: 'XLY', BKNG: 'XLY', MAR: 'XLY', HLT: 'XLY', RCL: 'XLY',
  CCL: 'XLY', ABNB: 'XLY', EXPE: 'XLY', EBAY: 'XLY', ETSY: 'XLY',
  // Consumer Staples
  WMT: 'XLP', COST: 'XLP', PG: 'XLP', KO: 'XLP', PEP: 'XLP', PM: 'XLP',
  MO: 'XLP', CL: 'XLP', KMB: 'XLP', MDLZ: 'XLP',
  // Healthcare
  UNH: 'XLV', JNJ: 'XLV', LLY: 'XLV', PFE: 'XLV', ABBV: 'XLV', MRK: 'XLV',
  TMO: 'XLV', ABT: 'XLV', DHR: 'XLV', BMY: 'XLV', AMGN: 'XLV', GILD: 'XLV',
  ISRG: 'XLV', REGN: 'XLV', VRTX: 'XLV', BIIB: 'XLV',
  // Financials
  JPM: 'XLF', BAC: 'XLF', WFC: 'XLF', GS: 'XLF', MS: 'XLF', BLK: 'XLF',
  C: 'XLF', AXP: 'XLF', V: 'XLF', MA: 'XLF', PYPL: 'XLF', SQ: 'XLF',
  USB: 'XLF', PNC: 'XLF', TFC: 'XLF', COF: 'XLF', SCHW: 'XLF', ICE: 'XLF',
  // Energy
  XOM: 'XLE', CVX: 'XLE', COP: 'XLE', EOG: 'XLE', SLB: 'XLE', MPC: 'XLE',
  PSX: 'XLE', VLO: 'XLE', OXY: 'XLE', DVN: 'XLE',
  // Industrials
  BA: 'XLI', CAT: 'XLI', HON: 'XLI', LMT: 'XLI', RTX: 'XLI', DE: 'XLI',
  GE: 'XLI', MMM: 'XLI', UPS: 'XLI', FDX: 'XLI',
  // Materials
  FCX: 'XLB', NEM: 'XLB', APD: 'XLB', LIN: 'XLB', SHW: 'XLB', DD: 'XLB',
  // Utilities
  NEE: 'XLU', DUK: 'XLU', SO: 'XLU', D: 'XLU', AEP: 'XLU', EXC: 'XLU',
};

interface SectorMomentum {
  sectorEtf: string;
  sectorName: string;
  etfPrice: number;
  sma50: number;
  priceVsSma50Pct: number;
  trend: 'outperforming' | 'underperforming' | 'neutral';
}

const sectorCache = new Map<string, { data: SectorMomentum; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function getSectorMomentum(symbol: string): Promise<SectorMomentum | null> {
  const etf = SYMBOL_TO_SECTOR[symbol.toUpperCase()];
  if (!etf) return null;

  const cached = sectorCache.get(etf);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const ohlc = await getHistoricalQuotes(etf, '6mo', '1d');
    if (ohlc.length < 30) return null;

    const closes = ohlc.map((c) => c.close);
    const n = closes.length;
    const etfPrice = closes[n - 1];
    const sma50 = n >= 50
      ? closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50
      : closes.reduce((a, b) => a + b, 0) / n;

    const priceVsSma50Pct = Math.round(((etfPrice - sma50) / sma50) * 10000) / 100;
    const trend: SectorMomentum['trend'] =
      priceVsSma50Pct > 3 ? 'outperforming'
      : priceVsSma50Pct < -3 ? 'underperforming'
      : 'neutral';

    const result: SectorMomentum = {
      sectorEtf: etf,
      sectorName: SECTOR_ETFS[etf] ?? etf,
      etfPrice: Math.round(etfPrice * 100) / 100,
      sma50: Math.round(sma50 * 100) / 100,
      priceVsSma50Pct,
      trend,
    };

    sectorCache.set(etf, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return null;
  }
}
