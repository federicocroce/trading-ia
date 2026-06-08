/**
 * Seed map of ticker → company-name aliases, used to reconcile news headlines with the symbol
 * they were tagged to (the upstream feed's relatedTickers is sometimes wrong). Covers the
 * portfolio + frequently-confused majors observed in mismatches. Extend as needed; unknown
 * symbols fall back to permissive symbol-only matching (no false drops).
 */
export const SYMBOL_ALIASES: Record<string, string[]> = {
  PAM: ['Pampa Energía', 'Pampa Energia', 'Pampa'],
  YPF: ['YPF'],
  VIST: ['Vista Energy', 'Vista Oil', 'Vista'],
  GGAL: ['Grupo Galicia', 'Banco Galicia', 'Galicia'],
  NEM: ['Newmont'],
  MARA: ['Marathon Digital', 'Marathon'],
  HUT: ['Hut 8'],
  TSM: ['Taiwan Semiconductor', 'TSMC'],
  HSBC: ['HSBC Holdings', 'HSBC'],
  BP: ['BP plc', 'BP'],
  EOG: ['EOG Resources', 'EOG'],
  COP: ['ConocoPhillips', 'Conoco'],
  KWEB: ['KraneShares'],
  PDD: ['PDD Holdings', 'Pinduoduo', 'Temu'],
  GEV: ['GE Vernova', 'Vernova'],
  IEF: ['7-10 Year Treasury'],
  GLD: ['SPDR Gold'],
  TLT: ['20+ Year Treasury'],
  // Majors frequently confused in feeds (semis/health/energy/tech)
  NVDA: ['Nvidia', 'NVIDIA'],
  AVGO: ['Broadcom'],
  SMCI: ['Super Micro', 'Supermicro'],
  AMD: ['Advanced Micro Devices', 'AMD'],
  INTC: ['Intel'],
  MU: ['Micron'],
  UNH: ['UnitedHealth', 'United Health'],
  CVS: ['CVS Health', 'CVS'],
  XLE: ['Energy Select', 'XLE'],
  XLF: ['Financial Select', 'XLF'],
  EEM: ['Emerging Markets ETF'],
  SPY: ['S&P 500'],
  QQQ: ['Nasdaq 100', 'Invesco QQQ'],
  AAPL: ['Apple'],
  MSFT: ['Microsoft'],
  GOOGL: ['Alphabet', 'Google'],
  AMZN: ['Amazon'],
  META: ['Meta Platforms', 'Facebook'],
  COST: ['Costco'],
  WDAY: ['Workday'],
  HOOD: ['Robinhood'],
};

export function aliasesFor(symbol: string): string[] {
  return SYMBOL_ALIASES[symbol.toUpperCase()] ?? [];
}
