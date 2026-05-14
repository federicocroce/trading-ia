// Canonical ticker → sector mapping. Used by:
//   - news-radar aggregation (auto-cascade ticker votes to parent sector)
//   - frontend NewsRadar (reverse lookup: sector → tickers for click drilldown)
//
// Single source of truth. Add new tickers here as they get discovered/tracked.
// Sector names must match RADAR_CANONICAL_SECTORS in prompts.ts.

export const TICKER_TO_SECTOR: Record<string, string> = {
  // Bonds
  TLT: 'bonos_largos', AGG: 'bonos_largos', EMB: 'bonos_largos',
  HYG: 'bonos_largos', LQD: 'bonos_largos', SHY: 'bonos_cortos', IEF: 'bonos_largos',
  TIP: 'bonos_largos',
  // Commodities / metales
  GLD: 'oro', IAU: 'oro', SLV: 'metales', COPX: 'cobre', FCX: 'cobre',
  USO: 'petroleo', XLE: 'energia', UNG: 'gas',
  // Sectoriales
  XLK: 'tech', XLF: 'bancos', XLV: 'salud', XLI: 'manufactura', XLY: 'consumo',
  XLP: 'consumo', XLU: 'real_estate', XLB: 'metales',
  ITB: 'homebuilders', XHB: 'homebuilders',
  ITA: 'defensa', PPA: 'defensa',
  IBB: 'biotech', XBI: 'biotech',
  KRE: 'bancos', SOXX: 'semiconductores', SMH: 'semiconductores',
  IGV: 'software', BOTZ: 'ia', AIQ: 'ia', ROBO: 'ia',
  // Mega-caps US
  AAPL: 'tech', MSFT: 'tech', GOOGL: 'tech', META: 'tech', AMZN: 'tech',
  NVDA: 'semiconductores', AMD: 'semiconductores', INTC: 'semiconductores',
  TSLA: 'automotriz', F: 'automotriz', GM: 'automotriz',
  // Defense
  LMT: 'defensa', RTX: 'defensa', NOC: 'defensa', GD: 'defensa',
  // Energy
  XOM: 'petroleo', CVX: 'petroleo', COP: 'petroleo', SLB: 'petroleo', EOG: 'petroleo',
  OXY: 'petroleo', SHEL: 'petroleo',
  // Banks
  JPM: 'bancos', BAC: 'bancos', WFC: 'bancos', GS: 'bancos', C: 'bancos', MS: 'bancos',
  // Healthcare
  LLY: 'salud', PFE: 'salud', JNJ: 'salud', MRK: 'salud', ABBV: 'salud', UNH: 'salud',
  // Consumer/Retail
  WMT: 'retail', TGT: 'retail', COST: 'retail', HD: 'retail', NKE: 'retail',
  // Crypto
  'BTC-USD': 'crypto', 'ETH-USD': 'crypto', 'SOL-USD': 'crypto', 'ADA-USD': 'crypto',
  // Argentina
  VIST: 'argentina', YPF: 'argentina', PAM: 'argentina', GGAL: 'argentina',
  BMA: 'argentina', TGS: 'argentina', CEPU: 'argentina', BBAR: 'argentina',
  CRESY: 'argentina', SUPV: 'argentina', LOMA: 'argentina',
  // Emerging / regional
  EEM: 'emergentes', EWZ: 'emergentes', ARGT: 'argentina', MCHI: 'china',
  EZU: 'europa', VGK: 'europa', IEUR: 'europa', EWG: 'europa', EWQ: 'europa',
  EWJ: 'japon', INDA: 'india', EWU: 'uk',
};

/**
 * Reverse map: sector → tickers. Used by frontend to show "tickers candidatos" when
 * user clicks a sector signal in the radar.
 */
export function getTickersForSector(sector: string): string[] {
  const target = sector.toLowerCase();
  return Object.entries(TICKER_TO_SECTOR)
    .filter(([, sec]) => sec === target)
    .map(([ticker]) => ticker);
}
