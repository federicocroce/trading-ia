import type { Price, OHLC } from '@trading/shared';
import { getQuote, getQuotes, getHistoricalQuotes } from '../shared/yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';
import { createTtlCache, type TtlCache } from '../shared/ttl-cache.js';
import { envNumber } from '../shared/env-number.js';

// In-memory cache with TTL (lista completa para el ticker)
let cachedPrices: Price[] = [];
let lastFetch = 0;
const CACHE_TTL = 5_000; // 5 seconds

// Cache por símbolo — lazy para respetar envNumber (el hoisting ESM corre antes de
// dotenv.config()). El ticker lo pobla en getAllPrices, así que entrar a un símbolo
// reusa el precio ya traído en vez de repegarle a Yahoo.
let _priceCache: TtlCache<Price> | null = null;
function priceCache(): TtlCache<Price> {
  if (!_priceCache) _priceCache = createTtlCache<Price>(envNumber('PRICE_CACHE_TTL_MS', 15_000));
  return _priceCache;
}

// Cache de históricos por (símbolo, rango, intervalo). El OHLC diario no cambia
// intradía, así que el chart no repega a Yahoo en cada revisita/refetch.
let _historyCache: TtlCache<OHLC[]> | null = null;
function historyCache(): TtlCache<OHLC[]> {
  if (!_historyCache) _historyCache = createTtlCache<OHLC[]>(envNumber('HISTORY_CACHE_TTL_MS', 60_000));
  return _historyCache;
}

export async function getAllPrices(): Promise<Price[]> {
  const now = Date.now();
  if (cachedPrices.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedPrices;
  }

  cachedPrices = await getQuotes(getActiveSymbolList());
  lastFetch = now;
  // Warmea el cache por símbolo para que la vista de detalle no repegue a Yahoo.
  const pc = priceCache();
  for (const p of cachedPrices) pc.set(p.symbol, p);
  return cachedPrices;
}

export async function getPriceBySymbol(symbol: string): Promise<Price> {
  const cached = priceCache().get(symbol);
  if (cached) return cached;

  // priority: es una llamada interactiva (detalle de símbolo), salta el barrido del ticker.
  const price = await getQuote(symbol, { priority: true });
  priceCache().set(symbol, price);
  return price;
}

export async function getPriceHistory(
  symbol: string,
  range: string,
  interval: string,
): Promise<OHLC[]> {
  const key = `${symbol}:${range}:${interval}`;
  const cached = historyCache().get(key);
  if (cached) return cached;

  const ohlc = await getHistoricalQuotes(symbol, range, interval, { priority: true });
  historyCache().set(key, ohlc);
  return ohlc;
}

export function resetPriceCache(): void {
  cachedPrices = [];
  lastFetch = 0;
  _priceCache = null;
  _historyCache = null;
}
