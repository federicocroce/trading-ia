import type { OpportunitySector } from '../types/opportunity.js';

/**
 * Sector definitions: labels and emojis.
 * Symbols are NO LONGER hardcoded here — the scan universe comes from:
 *   1. DB watchlist/portfolio (symbols table)
 *   2. Discovered dynamically from news
 */
export const OPPORTUNITY_UNIVERSE: Record<OpportunitySector, {
  label: string;
  emoji: string;
  symbols: string[]; // kept for backward compat, but empty — dynamic now
}> = {
  'argentina-energy': { label: 'Argentina / Energía', emoji: '🇦🇷⛽', symbols: [] },
  'argentina-finance': { label: 'Argentina / Finanzas', emoji: '🇦🇷🏦', symbols: [] },
  'argentina-cedears': { label: 'Argentina / CEDEARs', emoji: '🇦🇷📈', symbols: [] },
  'us-energy': { label: 'US / Energía', emoji: '🇺🇸⛽', symbols: [] },
  'us-tech': { label: 'US / Tech', emoji: '🇺🇸💻', symbols: [] },
  crypto: { label: 'Crypto', emoji: '🌐', symbols: [] },
  bonds: { label: 'Bonos', emoji: '📜', symbols: [] },
  'etfs-sectors': { label: 'ETFs Sectoriales', emoji: '📊', symbols: [] },
  commodities: { label: 'Commodities', emoji: '🪙', symbols: [] },
  'emerging-markets': { label: 'Mercados Emergentes', emoji: '🌎', symbols: [] },
};

/** @deprecated Use getFullSymbolUniverse() from discovery-registry instead */
export const ALL_OPPORTUNITY_SYMBOLS: string[] = [];

export function getSectorForSymbol(symbol: string): OpportunitySector | null {
  // Static lookup no longer has symbols — always returns null
  // Use getSectorForSymbolDynamic() from discovery-registry instead
  for (const [sector, config] of Object.entries(OPPORTUNITY_UNIVERSE)) {
    if (config.symbols.includes(symbol)) return sector as OpportunitySector;
  }
  return null;
}

export function getSymbolsForSectors(_sectors: OpportunitySector[]): string[] {
  // No longer hardcoded — return empty, callers use dynamic universe
  return [];
}
