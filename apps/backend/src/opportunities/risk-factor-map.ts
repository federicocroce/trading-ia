import type { RiskFactor } from '@trading/shared';

/** Curated symbol → factors. Extend over time; misses fall back to sector inference. */
const SYMBOL_FACTORS: Record<string, RiskFactor[]> = {
  // Argentina / energy (current portfolio)
  YPF: ['oil', 'argentina', 'emerging-markets'],
  PAM: ['oil', 'gas', 'argentina'],
  VIST: ['oil', 'argentina'],
  GGAL: ['argentina', 'emerging-markets', 'risk-on'],
  // Crypto miners
  MARA: ['crypto', 'risk-on'],
  HUT: ['crypto', 'risk-on'],
  // Commodities / gold
  NEM: ['gold'],
  GLD: ['gold', 'safe-haven'],
  GDX: ['gold'],
  // Semis
  TSM: ['semis', 'china'],
  // US oil majors / E&P
  EOG: ['oil', 'us-equity'],
  COP: ['oil', 'us-equity'],
  BP: ['oil', 'us-equity'],
  XLE: ['oil', 'us-equity'],
  APA: ['oil', 'us-equity'],
  // China / EM
  KWEB: ['china', 'emerging-markets', 'risk-on'],
  PDD: ['china', 'emerging-markets'],
  // Rates / safe-haven
  IEF: ['rates', 'safe-haven'],
  TLT: ['rates', 'safe-haven'],
  AGG: ['rates'],
  SHY: ['rates', 'safe-haven'],
  LQD: ['rates'],
  HYG: ['rates', 'risk-on'],
  TIP: ['rates', 'safe-haven'],
  // Broad US
  SPY: ['us-equity', 'risk-on'],
  // Ampliación 2026-07-23 — candidatos frecuentes que caían "sin clasificar" (el sector
  // 'etfs-sectors' del discovery es bolsa mixta y no sirve como fallback):
  // Mineras / EM
  VALE: ['emerging-markets', 'risk-on'],
  // Financieras US (incluye constituyentes del radar XLF)
  BLK: ['us-equity', 'risk-on'],
  JPM: ['us-equity', 'risk-on'],
  BAC: ['us-equity', 'risk-on'],
  WFC: ['us-equity', 'risk-on'],
  GS: ['us-equity', 'risk-on'],
  MS: ['us-equity', 'risk-on'],
  C: ['us-equity', 'risk-on'],
  AXP: ['us-equity', 'risk-on'],
  SCHW: ['us-equity', 'risk-on'],
  SPGI: ['us-equity', 'risk-on'],
  TFC: ['us-equity', 'risk-on'],
  // Industriales / defensa US
  GE: ['us-equity'],
  RTX: ['us-equity'],
  BA: ['us-equity'],
  LMT: ['us-equity'],
  NOC: ['us-equity'],
  SHW: ['us-equity'],
  CAT: ['us-equity'],
  // Semis (constituyentes del radar SMH)
  NVDA: ['semis', 'us-equity'],
  AMD: ['semis', 'us-equity'],
  AVGO: ['semis', 'us-equity'],
  MU: ['semis', 'us-equity'],
  QCOM: ['semis', 'us-equity'],
  AMAT: ['semis', 'us-equity'],
  LRCX: ['semis', 'us-equity'],
  INTC: ['semis', 'us-equity'],
  TXN: ['semis', 'us-equity'],
  ASML: ['semis', 'us-equity'],
  SMH: ['semis', 'us-equity'],
  SOXX: ['semis', 'us-equity'],
  // Índices amplios US
  QQQ: ['us-equity', 'risk-on'],
  VTI: ['us-equity', 'risk-on'],
  VOO: ['us-equity', 'risk-on'],
  IVV: ['us-equity', 'risk-on'],
  DIA: ['us-equity', 'risk-on'],
  IWM: ['us-equity', 'risk-on'],
};

/** Sector → factors fallback (sector strings come from getSectorForSymbolDynamic). */
const SECTOR_FACTORS: Record<string, RiskFactor[]> = {
  'us-energy': ['oil', 'us-equity'],
  'energy': ['oil'],
  'bonds': ['rates'],
  'us-tech': ['us-equity', 'risk-on'],
  'crypto': ['crypto', 'risk-on'],
};

export function factorsForSymbol(symbol: string, sector: string | undefined): RiskFactor[] {
  const direct = SYMBOL_FACTORS[symbol.toUpperCase()];
  if (direct) return [...direct];
  if (sector && SECTOR_FACTORS[sector]) return [...SECTOR_FACTORS[sector]];
  return [];
}

export function hasCuratedEntry(symbol: string): boolean {
  return symbol.toUpperCase() in SYMBOL_FACTORS;
}
