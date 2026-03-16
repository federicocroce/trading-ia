import { eq, desc, gte, and } from 'drizzle-orm';
import { db, schema } from './index.js';

// ==================== SYMBOLS ====================

export function getAllSymbols() {
  return db.select().from(schema.symbols).where(eq(schema.symbols.active, true)).all();
}

export function getSymbol(symbol: string) {
  return db.select().from(schema.symbols).where(eq(schema.symbols.symbol, symbol)).get();
}

export function insertSymbol(data: {
  symbol: string;
  name: string;
  type: 'adr' | 'us' | 'crypto';
  flag?: string;
  plaza?: 'argentina-energy' | 'argentina-finance' | 'us-energy' | 'crypto' | 'global';
}) {
  return db.insert(schema.symbols).values(data).run();
}

export function updateSymbol(symbol: string, data: Partial<{
  name: string;
  type: 'adr' | 'us' | 'crypto';
  flag: string;
  plaza: 'argentina-energy' | 'argentina-finance' | 'us-energy' | 'crypto' | 'global';
  active: boolean;
}>) {
  return db.update(schema.symbols).set(data).where(eq(schema.symbols.symbol, symbol)).run();
}

export function deleteSymbol(symbol: string) {
  // Soft delete — set active=false
  return db.update(schema.symbols).set({ active: false }).where(eq(schema.symbols.symbol, symbol)).run();
}

// ==================== POSITIONS ====================

export function getAllPositions() {
  return db.select().from(schema.positions).all();
}

export function getPositionBySymbol(symbol: string) {
  return db.select().from(schema.positions).where(eq(schema.positions.symbol, symbol)).get();
}

export function upsertPosition(data: { symbol: string; quantity: number; avgCost: number; notes?: string }) {
  const existing = getPositionBySymbol(data.symbol);
  if (existing) {
    return db.update(schema.positions)
      .set({ quantity: data.quantity, avgCost: data.avgCost, notes: data.notes, updatedAt: new Date().toISOString() })
      .where(eq(schema.positions.id, existing.id))
      .run();
  }
  return db.insert(schema.positions).values(data).run();
}

export function deletePosition(symbol: string) {
  return db.delete(schema.positions).where(eq(schema.positions.symbol, symbol)).run();
}

// ==================== TRANSACTIONS ====================

export function getTransactions(symbol?: string) {
  if (symbol) {
    return db.select().from(schema.transactions)
      .where(eq(schema.transactions.symbol, symbol))
      .orderBy(desc(schema.transactions.date))
      .all();
  }
  return db.select().from(schema.transactions).orderBy(desc(schema.transactions.date)).all();
}

export function insertTransaction(data: {
  symbol: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  quantity: number;
  price: number;
  fees?: number;
  date: string;
  currency?: string;
  totalAmount?: number;
  platform?: string;
  externalId?: string;
  notes?: string;
}) {
  return db.insert(schema.transactions).values(data).run();
}

export function deleteTransaction(id: number) {
  return db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run();
}

// ==================== Derived helpers ====================

/** Get all active symbol strings (replaces ALL_SYMBOLS constant) */
export function getActiveSymbolList(): string[] {
  return getAllSymbols().map((s) => s.symbol);
}

/** Get position data in the format portfolio.service.ts expects */
export function getPortfolioPositions(): Array<{ symbol: string; quantity: number; avgCost: number }> {
  return getAllPositions().map((p) => ({
    symbol: p.symbol,
    quantity: p.quantity,
    avgCost: p.avgCost,
  }));
}

// ==================== OPPORTUNITY SCANS ====================

export function insertOpportunityScan(data: {
  scannedAt: string;
  engine: string;
  engineDetail: string;
  totalSymbolsScanned: number;
  opportunityCount: number;
  opportunities: string; // JSON stringified
  sectorSummary: string; // JSON stringified
}) {
  return db.insert(schema.opportunityScans).values(data).run();
}

export function getLatestOpportunityScan() {
  return db.select().from(schema.opportunityScans)
    .orderBy(desc(schema.opportunityScans.id))
    .limit(1)
    .get();
}

export function getOpportunityScans(limit: number = 20) {
  return db.select({
    id: schema.opportunityScans.id,
    scannedAt: schema.opportunityScans.scannedAt,
    engine: schema.opportunityScans.engine,
    engineDetail: schema.opportunityScans.engineDetail,
    totalSymbolsScanned: schema.opportunityScans.totalSymbolsScanned,
    opportunityCount: schema.opportunityScans.opportunityCount,
    createdAt: schema.opportunityScans.createdAt,
  }).from(schema.opportunityScans)
    .orderBy(desc(schema.opportunityScans.id))
    .limit(limit)
    .all();
}

export function getOpportunityScanById(id: number) {
  return db.select().from(schema.opportunityScans)
    .where(eq(schema.opportunityScans.id, id))
    .get();
}

// ==================== OPPORTUNITY SNAPSHOTS ====================

export function insertOpportunitySnapshots(snapshots: Array<{
  scanId: number;
  symbol: string;
  sector: string;
  opportunityScore: number;
  recommendation: string;
  currentPrice: number;
  shortTermMid: number;
  mediumTermMid: number;
  confidence: number;
  reasoning: string;
  data: string; // JSON stringified
  scannedAt: string;
}>) {
  if (snapshots.length === 0) return;
  return db.insert(schema.opportunitySnapshots).values(snapshots).run();
}

export function getSnapshotsForScan(scanId: number) {
  return db.select().from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.scanId, scanId))
    .orderBy(desc(schema.opportunitySnapshots.opportunityScore))
    .all();
}

export function getSymbolHistory(symbol: string, limit: number = 30) {
  return db.select().from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.symbol, symbol))
    .orderBy(desc(schema.opportunitySnapshots.scannedAt))
    .limit(limit)
    .all();
}

export function getSnapshotsSince(sinceDate: string) {
  return db.select().from(schema.opportunitySnapshots)
    .where(gte(schema.opportunitySnapshots.scannedAt, sinceDate))
    .orderBy(desc(schema.opportunitySnapshots.scannedAt))
    .all();
}

/**
 * Recalcula positions desde las transacciones.
 * BUY/DIVIDEND suman cantidad, SELL resta.
 * avgCost = costo total acumulado (solo BUY) / cantidad total.
 * Los dividendos reinvertidos se suman a quantity pero no al costo (son "gratis").
 */
export function rebuildPositionsFromTransactions() {
  const txs = db.select().from(schema.transactions).all();

  const map = new Map<string, { quantity: number; totalCost: number }>();

  for (const tx of txs) {
    const entry = map.get(tx.symbol) ?? { quantity: 0, totalCost: 0 };

    if (tx.type === 'BUY') {
      const cost = tx.totalAmount ?? tx.quantity * tx.price;
      entry.totalCost += cost;
      entry.quantity += tx.quantity;
    } else if (tx.type === 'DIVIDEND') {
      // Dividendos reinvertidos: suman acciones pero no costo (costo = 0)
      entry.quantity += tx.quantity;
    } else if (tx.type === 'SELL') {
      // Al vender, reducimos proporcionalmente el costo
      const avgCostBefore = entry.quantity > 0 ? entry.totalCost / entry.quantity : 0;
      entry.quantity -= tx.quantity;
      entry.totalCost = entry.quantity * avgCostBefore;
    }

    map.set(tx.symbol, entry);
  }

  // Clear all positions and rebuild
  db.delete(schema.positions).run();

  for (const [symbol, data] of map) {
    if (data.quantity <= 0) continue;
    const avgCost = data.totalCost / data.quantity;
    db.insert(schema.positions).values({
      symbol,
      quantity: data.quantity,
      avgCost,
    }).run();
  }

  return map.size;
}
