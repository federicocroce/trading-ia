export const ETF_CATEGORY_ORDER = [
  'indices',
  'sectores',
  'bonos',
  'commodities',
  'latam',
  'internacional',
  'crypto',
  'factor',
] as const;

export type EtfCategory = (typeof ETF_CATEGORY_ORDER)[number];

export const ETF_CATEGORY_LABELS: Record<EtfCategory, string> = {
  indices: 'Índices',
  sectores: 'Sectores',
  bonos: 'Bonos',
  commodities: 'Commodities',
  latam: 'Latam',
  internacional: 'Internacional',
  crypto: 'Crypto',
  factor: 'Factor',
};
