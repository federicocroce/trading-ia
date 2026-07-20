import type { AssetClassification, DiscoveredTickerInfo, OpportunitySector } from '@trading/shared';
import { ALL_OPPORTUNITY_SYMBOLS, OPPORTUNITY_UNIVERSE, getSectorForSymbol } from '@trading/shared';
import {
  getActiveDiscoveredSymbols,
  upsertDiscoveredSymbol,
  deactivateExpiredDiscoveries,
  getActiveSymbolList,
  insertSymbol,
  getSymbol,
} from '../db/repository.js';
import { validateTickers } from './ticker-validator.js';
import { classifyAsset, getCachedClassification } from './asset-classifier.js';

const MAX_DISCOVERED = 120;
const DISCOVERY_TTL_DAYS = 14;
const EVICTION_BATCH_SIZE = 20;  // when at cap, evict bottom 20 by relevance to make room

const SCREENER_INITIAL_RELEVANCE = 30;  // ya pasó el embudo operable: vale ~3 menciones de noticias
const DEFAULT_INITIAL_RELEVANCE = 10;   // una mención

// Fuentes de descubrimiento: noticias/screener original + radar de ciclos y barrido de bases (Task 2).
type DiscoverySource = 'finnhub' | 'yahoo' | 'llm' | 'screener' | 'radar' | 'base_sweep';

// Pura: relevance inicial según la fuente del descubrimiento.
export function initialRelevanceForSource(source: DiscoverySource): number {
  return source === 'screener' ? SCREENER_INITIAL_RELEVANCE : DEFAULT_INITIAL_RELEVANCE;
}

// Pura: candidatos a evictar al cap — menor relevance primero, desempate por lastSeen más viejo.
export function selectEvictionCandidates<T extends { symbol: string; relevanceScore: number | null; lastSeen: string | null }>(
  rows: T[],
  batchSize: number,
): T[] {
  return [...rows]
    .sort((a, b) => {
      const relA = a.relevanceScore ?? 0;
      const relB = b.relevanceScore ?? 0;
      if (relA !== relB) return relA - relB;
      return new Date(a.lastSeen ?? 0).getTime() - new Date(b.lastSeen ?? 0).getTime();
    })
    .slice(0, batchSize);
}

/**
 * Register novel tickers found in news articles.
 * Validates, classifies, and persists them.
 */
export async function registerNovelTickers(
  tickers: string[],
  source: DiscoverySource,
): Promise<number> {
  // Already at max? Evict lowest-relevance to make room for new candidates.
  let current = getActiveDiscoveredSymbols();
  if (current.length >= MAX_DISCOVERED) {
    const toEvict = selectEvictionCandidates(current, EVICTION_BATCH_SIZE);
    if (toEvict.length > 0) {
      console.log(`[Discovery] Evicting ${toEvict.length} low-relevance symbols: ${toEvict.map(t => t.symbol).join(', ')}`);
      // Lazy import to avoid circular
      const { db } = await import('../db/index.js');
      const schema = await import('../db/schema.js');
      const { inArray } = await import('drizzle-orm');
      db.update(schema.discoveredSymbols)
        .set({ active: false })
        .where(inArray(schema.discoveredSymbols.symbol, toEvict.map(t => t.symbol)))
        .run();
      current = getActiveDiscoveredSymbols();
    }
  }
  const remaining = MAX_DISCOVERED - current.length;
  if (remaining <= 0) return 0;

  // Filter out already known
  const known = new Set([...getActiveSymbolList(), ...current.map(s => s.symbol)]);
  const novel = tickers.filter(t => !known.has(t));
  if (novel.length === 0) return 0;

  // Validate (max 40 per batch — discovery throughput on busy news cycles)
  const toValidate = novel.slice(0, Math.min(40, remaining));
  const valid = await validateTickers(toValidate);
  if (valid.length === 0) return 0;

  // Classify and persist
  let registered = 0;
  const expiresAt = new Date(Date.now() + DISCOVERY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const symbol of valid) {
    if (registered >= remaining) break;

    try {
      const classification = await classifyAsset(symbol);
      if (!classification) continue;

      upsertDiscoveredSymbol({
        symbol,
        name: classification.name,
        instrumentType: classification.instrumentType,
        sector: classification.sector,
        industry: classification.industry,
        market: classification.market,
        exchange: classification.exchange ?? null,
        discoveredFrom: source,
        relevanceScore: initialRelevanceForSource(source),
        expiresAt,
      });
      registered++;
    } catch {
      // Skip on error
    }
  }

  if (registered > 0) {
    console.log(`[Discovery] ${registered} nuevos tickers registrados: ${valid.slice(0, registered).join(', ')}`);
  }

  return registered;
}

/**
 * Get all discovered tickers (non-expired, active).
 */
export function getDiscoveredTickers(): DiscoveredTickerInfo[] {
  const rows = getActiveDiscoveredSymbols();
  return rows.map(r => ({
    symbol: r.symbol,
    classification: {
      instrumentType: r.instrumentType as AssetClassification['instrumentType'],
      sector: r.sector,
      industry: r.industry ?? r.sector,
      market: r.market as AssetClassification['market'],
      exchange: r.exchange ?? undefined,
      name: r.name,
    },
    discoveredFrom: r.discoveredFrom as DiscoveredTickerInfo['discoveredFrom'],
    newsCount: r.newsCount ?? 1,
    relevanceScore: r.relevanceScore ?? 0,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    expiresAt: r.expiresAt,
    active: true,
  }));
}

/**
 * Full symbol universe = DB watchlist/portfolio + discovered by news.
 */
export function getFullSymbolUniverse(): string[] {
  const dbSymbols = getActiveSymbolList();
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  return [...new Set([...dbSymbols, ...discovered])];
}

/**
 * Dynamic sector lookup: hardcoded first, then discovered, then null.
 */
export function getSectorForSymbolDynamic(symbol: string): OpportunitySector | null {
  // Try hardcoded first
  const hardcoded = getSectorForSymbol(symbol);
  if (hardcoded) return hardcoded;

  // Try discovered — map classification to OpportunitySector
  const classification = getCachedClassification(symbol);
  if (classification) return mapClassificationToSector(classification);

  // Try DB discovered
  const discovered = getActiveDiscoveredSymbols().find(s => s.symbol === symbol);
  if (discovered) {
    return mapClassificationToSector({
      instrumentType: discovered.instrumentType as AssetClassification['instrumentType'],
      sector: discovered.sector,
      industry: discovered.industry ?? discovered.sector,
      market: discovered.market as AssetClassification['market'],
      name: discovered.name,
    });
  }

  return null;
}

/**
 * Get sector label for display (dynamic).
 */
export function getSectorLabelDynamic(symbol: string, sector: OpportunitySector): string {
  const universeEntry = OPPORTUNITY_UNIVERSE[sector];
  if (universeEntry) return universeEntry.label;

  // Fallback for dynamic
  const classification = getCachedClassification(symbol);
  if (classification) {
    const typeLabel = classification.instrumentType === 'cedear' ? 'CEDEAR'
      : classification.instrumentType === 'etf' ? 'ETF'
      : classification.instrumentType === 'crypto' ? 'Crypto'
      : classification.instrumentType === 'bono' ? 'Bono'
      : classification.instrumentType === 'commodity' ? 'Commodity'
      : 'Acción';
    return `${typeLabel} · ${classification.sector}`;
  }

  return sector;
}

/**
 * Get classification for any symbol (hardcoded or discovered).
 */
export function getClassificationForSymbol(symbol: string): AssetClassification | undefined {
  // Check cached classification first (from Yahoo Finance)
  const cached = getCachedClassification(symbol);
  if (cached) return cached;

  // Check discovered symbols table
  const discovered = getActiveDiscoveredSymbols().find(s => s.symbol === symbol);
  if (discovered) {
    return {
      instrumentType: (discovered.instrumentType ?? 'accion') as AssetClassification['instrumentType'],
      sector: discovered.sector ?? 'Otros',
      industry: discovered.industry ?? 'Desconocido',
      market: (discovered.market ?? 'global') as AssetClassification['market'],
      name: discovered.name ?? symbol,
    };
  }

  return undefined;
}

// Stable classification logic — sector names are part of the domain model, not user-configurable data.
// Changes here require deliberate domain decisions, not just DB edits.
function mapClassificationToSector(c: AssetClassification): OpportunitySector {
  if (c.instrumentType === 'crypto') return 'crypto';
  if (c.instrumentType === 'bono') return 'bonds';
  if (c.instrumentType === 'commodity') return 'commodities';
  if (c.instrumentType === 'etf') return 'etfs-sectors';

  if (c.market === 'argentina') {
    if (['Petróleo', 'Energía', 'Gas & Petróleo', 'Energía Eléctrica'].includes(c.sector)) return 'argentina-energy';
    if (['Banca', 'Finanzas', 'Seguros'].includes(c.sector)) return 'argentina-finance';
    return 'argentina-cedears';
  }

  if (['Petróleo', 'Energía', 'Gas & Petróleo', 'Servicios Petróleo'].includes(c.sector)) return 'us-energy';
  if (['Tecnología', 'Tech', 'Software', 'Semiconductores', 'E-commerce', 'Electrónica', 'Gaming', 'Comunicaciones'].includes(c.sector)) return 'us-tech';

  return 'etfs-sectors'; // catch-all
}

/**
 * Prune expired discoveries.
 */
export function pruneExpiredDiscoveries(): number {
  return deactivateExpiredDiscoveries();
}

/**
 * Promote a discovered ticker to permanent watchlist (DB symbols table).
 * Returns true if promoted, false if already exists or not found.
 */
export function promoteToWatchlist(symbol: string): boolean {
  // Already in watchlist?
  const existing = getSymbol(symbol);
  if (existing) return false;

  // Get classification
  const classification = getCachedClassification(symbol);
  const discovered = getActiveDiscoveredSymbols().find(s => s.symbol === symbol);

  const name = classification?.name ?? discovered?.name ?? symbol;
  const market = classification?.market ?? discovered?.market ?? 'global';
  const instrumentType = classification?.instrumentType ?? discovered?.instrumentType ?? 'us';

  // Map instrumentType to DB type — preserve bonds/ETFs/commodities for accurate classification
  const dbType = instrumentType === 'crypto' ? 'crypto' as const
    : instrumentType === 'bono' ? 'bond' as const
    : instrumentType === 'etf' ? 'etf' as const
    : instrumentType === 'commodity' ? 'commodity' as const
    : (market === 'argentina' || instrumentType === 'cedear') ? 'adr' as const
    : 'us' as const;

  // Map to plaza/sector
  const sector = getSectorForSymbolDynamic(symbol);
  const plaza = sector ?? 'global';

  // Map market to flag
  const flag = market === 'argentina' ? '🇦🇷' : market === 'us' ? '🇺🇸' : '🌐';

  try {
    insertSymbol({
      symbol,
      name,
      type: dbType,
      flag,
      plaza,
    });
    console.log(`[Discovery] ${symbol} promoted to watchlist (${name}, ${plaza})`);
    return true;
  } catch (err) {
    console.warn(`[Discovery] Failed to promote ${symbol}:`, err);
    return false;
  }
}
