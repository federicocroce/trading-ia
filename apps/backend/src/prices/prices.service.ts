import type { Price } from '@trading/shared';
import { getQuote, getQuotes } from '../shared/yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';

// In-memory cache with TTL
let cachedPrices: Price[] = [];
let lastFetch = 0;
const CACHE_TTL = 5_000; // 5 seconds

export async function getAllPrices(): Promise<Price[]> {
  const now = Date.now();
  if (cachedPrices.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedPrices;
  }

  cachedPrices = await getQuotes(getActiveSymbolList());
  lastFetch = now;
  return cachedPrices;
}

export async function getPriceBySymbol(symbol: string): Promise<Price> {
  return getQuote(symbol);
}

export function resetPriceCache(): void {
  cachedPrices = [];
  lastFetch = 0;
}
