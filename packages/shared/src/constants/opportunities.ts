import type { OpportunitySector } from '../types/opportunity.js';

export const OPPORTUNITY_UNIVERSE: Record<OpportunitySector, {
  label: string;
  emoji: string;
  symbols: string[];
}> = {
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
    symbols: ['MELI', 'GLOB', 'DESP', 'CAAP', 'LOMA', 'TXAR'],
  },
  'us-energy': {
    label: 'US / Energía',
    emoji: '🇺🇸⛽',
    symbols: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PXD', 'HAL'],
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
};

export const ALL_OPPORTUNITY_SYMBOLS: string[] = Object.values(OPPORTUNITY_UNIVERSE)
  .flatMap((s) => s.symbols);

export function getSectorForSymbol(symbol: string): OpportunitySector | null {
  for (const [sector, config] of Object.entries(OPPORTUNITY_UNIVERSE)) {
    if (config.symbols.includes(symbol)) return sector as OpportunitySector;
  }
  return null;
}

export function getSymbolsForSectors(sectors: OpportunitySector[]): string[] {
  return sectors.flatMap((s) => OPPORTUNITY_UNIVERSE[s].symbols);
}
