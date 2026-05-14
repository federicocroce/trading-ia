export type InstrumentFilter = 'all' | 'accion-us' | 'cedear' | 'etf' | 'crypto' | 'bono' | 'commodity';
export type InstrumentKind = Exclude<InstrumentFilter, 'all'>;

export interface SymbolMeta {
  type?: string | null;
  plaza?: string | null;
}

export function classifyInstrument(s: SymbolMeta): InstrumentKind {
  if (s.plaza === 'argentina-cedears' || s.type === 'adr') return 'cedear';
  if (s.type === 'crypto') return 'crypto';
  if (s.type === 'bond') return 'bono';
  if (s.type === 'etf' || s.plaza === 'etfs-sectors') return 'etf';
  if (s.type === 'commodity' || s.plaza === 'commodities') return 'commodity';
  return 'accion-us';
}

export const INSTRUMENT_LABELS: Record<InstrumentFilter, string> = {
  all: 'Todos',
  'accion-us': 'Acciones US',
  cedear: 'CEDEARs',
  etf: 'ETFs',
  crypto: 'Crypto',
  bono: 'Bonos',
  commodity: 'Commodities',
};

export const INSTRUMENT_SHORT_LABELS: Record<InstrumentKind, string> = {
  'accion-us': 'US',
  cedear: 'CEDEAR',
  etf: 'ETF',
  crypto: 'CRYPTO',
  bono: 'BONO',
  commodity: 'COMM',
};

export const INSTRUMENT_BADGE_CLASSES: Record<InstrumentKind, string> = {
  'accion-us': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  cedear: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  etf: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  crypto: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bono: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  commodity: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};
