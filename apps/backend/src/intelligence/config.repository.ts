import { db } from '../db/index.js';
import { discoveryQueries, thematicQueries } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ─── Default seeds ────────────────────────────────────────────────────────────

const DEFAULT_DISCOVERY_QUERIES = [
  { query: 'stock market biggest movers today surge rally NYSE NASDAQ', lang: 'en' as const, category: 'general', priority: 1 },
  { query: 'earnings beat miss surprise stocks today analyst upgrade downgrade', lang: 'en' as const, category: 'general', priority: 2 },
  { query: 'oil gas energy stocks news today price move', lang: 'en' as const, category: 'energy', priority: 3 },
  { query: 'acciones argentinas noticias hoy merval cedear movimiento precio', lang: 'es' as const, category: 'argentina', priority: 4 },
  { query: 'bitcoin ethereum crypto price news today move', lang: 'en' as const, category: 'crypto', priority: 5 },
  { query: 'fed reserve interest rate inflation news market impact today', lang: 'en' as const, category: 'macro', priority: 6 },
  { query: 'stock breakout technical analysis today high volume', lang: 'en' as const, category: 'general', priority: 7 },
];

const DEFAULT_THEMATIC_QUERIES = [
  { name: 'Política monetaria', keywords: JSON.stringify(['Fed', 'interest rates', 'inflation', 'CPI', 'FOMC', 'Powell', 'ECB', 'rate hike', 'rate cut']), priority: 1 },
  { name: 'Comercio y aranceles', keywords: JSON.stringify(['tariffs', 'trade', 'China', 'supply chain', 'export', 'import', 'WTO', 'trade war']), priority: 2 },
  { name: 'Tecnología e IA', keywords: JSON.stringify(['AI', 'semiconductor', 'earnings', 'NVIDIA', 'chips', 'data center', 'machine learning', 'Broadcom']), priority: 3 },
  { name: 'Mercados emergentes y Argentina', keywords: JSON.stringify(['Argentina', 'IMF', 'emerging', 'Latin America', 'Brazil', 'CEDEAR', 'Merval', 'peso']), priority: 4 },
  { name: 'Energía y petróleo', keywords: JSON.stringify(['oil', 'OPEC', 'crude', 'gas', 'renewable', 'energy', 'Brent', 'WTI', 'petroleum']), priority: 5 },
  { name: 'M&A y earnings', keywords: JSON.stringify(['merger', 'acquisition', 'earnings', 'IPO', 'buyout', 'revenue', 'guidance', 'beat', 'miss']), priority: 6 },
  { name: 'Crypto y fintech', keywords: JSON.stringify(['Bitcoin', 'blockchain', 'DeFi', 'SEC', 'Ethereum', 'crypto', 'stablecoin', 'ETF crypto']), priority: 7 },
  { name: 'Commodities', keywords: JSON.stringify(['gold', 'copper', 'lithium', 'uranium', 'mining', 'metals', 'silver', 'platinum']), priority: 8 },
  { name: 'Salud y pharma', keywords: JSON.stringify(['FDA', 'biotech', 'drug', 'healthcare', 'clinical trial', 'approval', 'pharma', 'vaccine']), priority: 9 },
  { name: 'Geopolítica y conflictos', keywords: JSON.stringify(['war', 'conflict', 'sanctions', 'military', 'NATO', 'Russia', 'Ukraine', 'Middle East']), priority: 10 },
];

// ─── Seeding ──────────────────────────────────────────────────────────────────

export function seedConfigIfEmpty(): void {
  const existingDiscovery = db.select().from(discoveryQueries).all();
  if (existingDiscovery.length === 0) {
    db.transaction((trx) => {
      for (const q of DEFAULT_DISCOVERY_QUERIES) {
        trx.insert(discoveryQueries).values(q).run();
      }
    });
    console.log('[config] Seeded discovery queries with defaults');
  }

  const existingThematic = db.select().from(thematicQueries).all();
  if (existingThematic.length === 0) {
    db.transaction((trx) => {
      for (const q of DEFAULT_THEMATIC_QUERIES) {
        trx.insert(thematicQueries).values(q).run();
      }
    });
    console.log('[config] Seeded thematic queries with defaults');
  }
}

// ─── Discovery Queries ────────────────────────────────────────────────────────

export function getActiveDiscoveryQueries(): string[] {
  const rows = db.select()
    .from(discoveryQueries)
    .where(eq(discoveryQueries.active, true))
    .orderBy(discoveryQueries.priority)
    .all();
  return rows.map(r => r.query);
}

export function getAllDiscoveryQueries() {
  return db.select().from(discoveryQueries).orderBy(discoveryQueries.priority).all();
}

// All fields map directly to columns — no serialization needed
export function updateDiscoveryQuery(id: number, data: { query?: string; active?: boolean; priority?: number; category?: string }) {
  db.update(discoveryQueries).set(data).where(eq(discoveryQueries.id, id)).run();
}

export function addDiscoveryQuery(data: { query: string; lang: 'en' | 'es'; category?: string; priority?: number }) {
  return db.insert(discoveryQueries).values({
    query: data.query,
    lang: data.lang,
    category: data.category ?? 'general',
    priority: data.priority ?? 0,
  }).returning().get();
}

export function deleteDiscoveryQuery(id: number) {
  db.delete(discoveryQueries).where(eq(discoveryQueries.id, id)).run();
}

// ─── Thematic Queries ─────────────────────────────────────────────────────────

export type ThematicQuery = { id: number; name: string; keywords: string[]; active: boolean; priority: number };

export function getActiveThematicQueries(): Array<{ theme: string; query: string }> {
  const rows = db.select()
    .from(thematicQueries)
    .where(eq(thematicQueries.active, true))
    .orderBy(thematicQueries.priority)
    .all();
  return rows.map(r => ({
    theme: r.name,
    query: (() => {
      try { return (JSON.parse(r.keywords) as string[]).join(' OR '); }
      catch { return r.keywords; }
    })(),
  }));
}

export function getAllThematicQueries(): ThematicQuery[] {
  const rows = db.select().from(thematicQueries).orderBy(thematicQueries.priority).all();
  return rows.map(r => {
    let keywords: string[];
    try { keywords = JSON.parse(r.keywords) as string[]; }
    catch { keywords = [r.keywords]; }
    return { ...r, keywords };
  });
}

// keywords requires JSON serialization — cannot pass data object directly to .set()
export function updateThematicQuery(id: number, data: { name?: string; keywords?: string[]; active?: boolean; priority?: number }) {
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.active !== undefined) update.active = data.active;
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.keywords !== undefined) update.keywords = JSON.stringify(data.keywords);
  db.update(thematicQueries).set(update).where(eq(thematicQueries.id, id)).run();
}

export function addThematicQuery(data: { name: string; keywords: string[]; priority?: number }) {
  return db.insert(thematicQueries).values({
    name: data.name,
    keywords: JSON.stringify(data.keywords),
    priority: data.priority ?? 0,
  }).returning().get();
}

export function deleteThematicQuery(id: number) {
  db.delete(thematicQueries).where(eq(thematicQueries.id, id)).run();
}
