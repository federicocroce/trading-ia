import type { MarketPlaza } from '../types/news.js';

export const PLAZA_CONFIG: Record<MarketPlaza, { label: string; emoji: string; symbols: string[] }> = {
  'argentina-energy': {
    label: 'Argentina / Energía',
    emoji: '🇦🇷⛽',
    symbols: ['VIST', 'YPF', 'PAM', 'TGS', 'CEPU'],
  },
  'argentina-finance': {
    label: 'Argentina / Finanzas',
    emoji: '🇦🇷🏦',
    symbols: ['GGAL', 'BMA', 'BBAR', 'SUPV', 'CRESY'],
  },
  'argentina-cedears': {
    label: 'Argentina / CEDEARs',
    emoji: '🇦🇷📈',
    symbols: ['MELI', 'GLOB', 'CAAP', 'LOMA', 'TEO', 'BIOX'],
  },
  'us-energy': {
    label: 'US / Energía',
    emoji: '🇺🇸⛽',
    symbols: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'HAL'],
  },
  'us-tech': {
    label: 'US / Tech',
    emoji: '🇺🇸💻',
    symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'],
  },
  crypto: {
    label: 'Crypto',
    emoji: '🌐',
    symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ADA-USD', 'DOGE-USD', 'AVAX-USD'],
  },
  bonds: {
    label: 'Bonos',
    emoji: '📜',
    symbols: ['TLT', 'HYG', 'EMB', 'AGG'],
  },
  'etfs-sectors': {
    label: 'ETFs Sectoriales',
    emoji: '📊',
    symbols: ['SPY', 'QQQ', 'XLE', 'XLF', 'DIA'],
  },
  commodities: {
    label: 'Commodities',
    emoji: '🪙',
    symbols: ['GLD', 'SLV', 'USO', 'UNG', 'COPX'],
  },
  'emerging-markets': {
    label: 'Mercados Emergentes',
    emoji: '🌎',
    symbols: ['EEM', 'EWZ', 'ARGT'],
  },
  global: {
    label: 'Global / Macro',
    emoji: '🌍',
    symbols: [],
  },
};

export function getPlazaForSymbol(symbol: string): MarketPlaza {
  for (const [plaza, config] of Object.entries(PLAZA_CONFIG)) {
    if (config.symbols.includes(symbol)) return plaza as MarketPlaza;
  }
  return 'global';
}
