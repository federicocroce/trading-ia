import { eq, desc, gte, lt, asc, and, inArray, gt, sql, isNull, ne } from 'drizzle-orm';
import type { AnticipatoryAlert } from '@trading/shared';
import { db, schema } from './index.js';
import { missedOpportunities, signalTracking, etfWatchlist } from './schema.js';
import { envNumber } from '../shared/env-number.js';

// ==================== SYMBOLS ====================

export function getAllSymbols() {
  return db.select().from(schema.symbols).where(eq(schema.symbols.active, true)).all();
}

export function getSymbol(symbol: string) {
  return db.select().from(schema.symbols).where(eq(schema.symbols.symbol, symbol)).get();
}

type SymbolPlaza = 'argentina-energy' | 'argentina-finance' | 'argentina-cedears' | 'us-energy' | 'us-tech' | 'crypto' | 'bonds' | 'etfs-sectors' | 'commodities' | 'emerging-markets' | 'global';

export type SymbolType = 'adr' | 'us' | 'crypto' | 'bond' | 'etf' | 'commodity';

export function insertSymbol(data: {
  symbol: string;
  name: string;
  type: SymbolType;
  flag?: string;
  plaza?: string;
}) {
  return db.insert(schema.symbols).values({
    ...data,
    plaza: (data.plaza ?? 'global') as SymbolPlaza,
  }).run();
}

export function updateSymbol(symbol: string, data: Partial<{
  name: string;
  type: SymbolType;
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
  const portfolioSymbols = getAllSymbols().map((s) => s.symbol);
  const etfSymbols = getEtfSymbols();
  return [...new Set([...portfolioSymbols, ...etfSymbols])];
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

export function getOpportunityScanDates(): string[] {
  return db.selectDistinct({ date: sql<string>`substr(${schema.opportunityScans.scannedAt}, 1, 10)` })
    .from(schema.opportunityScans)
    .orderBy(desc(sql`substr(${schema.opportunityScans.scannedAt}, 1, 10)`))
    .all()
    .map(r => r.date);
}

export function getOpportunityScanByDate(date: string) {
  const nextDay = new Date(date + 'T00:00:00.000Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];
  return db.select().from(schema.opportunityScans)
    .where(and(gte(schema.opportunityScans.scannedAt, date), lt(schema.opportunityScans.scannedAt, nextDayStr)))
    .orderBy(desc(schema.opportunityScans.id))
    .limit(1)
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

/**
 * Símbolos cuyo snapshot de una fecha dada quedó con setup de riesgo invalid (degradado
 * BUY/WATCH→WATCH/HOLD). setupQuality vive dentro del JSON del snapshot (tradeLevels es
 * opcional en el scan real), de ahí el json_extract en vez de una columna dedicada.
 */
export function getInvalidSetupSymbolsByDate(date: string): Set<string> {
  const nextDay = new Date(date + 'T00:00:00.000Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];
  const rows = db.select({ symbol: schema.opportunitySnapshots.symbol })
    .from(schema.opportunitySnapshots)
    .where(and(
      gte(schema.opportunitySnapshots.scannedAt, date),
      lt(schema.opportunitySnapshots.scannedAt, nextDayStr),
      sql`json_extract(${schema.opportunitySnapshots.data}, '$.tradeLevels.setupQuality') = 'invalid'`,
    ))
    .all();
  return new Set(rows.map(r => r.symbol));
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
  // ORDER BY date to ensure correct cost basis calculation
  const txs = db.select().from(schema.transactions).orderBy(asc(schema.transactions.date)).all();

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

  // Atomic: delete all + insert new in single transaction
  db.transaction((trx) => {
    trx.delete(schema.positions).run();
    for (const [symbol, data] of map) {
      if (data.quantity <= 0) continue;
      const avgCost = data.totalCost / data.quantity;
      trx.insert(schema.positions).values({ symbol, quantity: data.quantity, avgCost }).run();
    }
  });

  return map.size;
}

// ==================== DAILY REPORTS ====================

export function insertDailyReport(data: {
  reportDate: string;
  reportType: string;
  scanId?: number;
  newsSourceStats: string;
  totalNewsCount: number;
  triangulationStats: string;
  secondOrderEffects: string;
  antiHypeResults: string;
  topRecommendations: string;
  sectorSummary: string;
  totalSymbolsScanned: number;
  analysisEngine: string;
  analysisDetail: string;
}) {
  return db.insert(schema.dailyReports).values(data).run();
}

export function getLatestDailyReport() {
  return db.select().from(schema.dailyReports)
    .orderBy(desc(schema.dailyReports.id))
    .limit(1)
    .get();
}

export function getDailyReportByDate(date: string) {
  return db.select().from(schema.dailyReports)
    .where(eq(schema.dailyReports.reportDate, date))
    .orderBy(desc(schema.dailyReports.id))
    .limit(1)
    .get();
}

// ==================== NEWS ARTICLES ====================

export function insertNewsArticles(articles: Array<{
  externalId: string;
  source: string;
  sourceType: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt: string;
  relatedSymbols: string[];
}>): number {
  if (articles.length === 0) return 0;

  // Batch check existing IDs instead of N+1 queries
  const existingIds = getExistingExternalIds(articles.map(a => a.externalId));

  let inserted = 0;
  for (const a of articles) {
    if (existingIds.has(a.externalId)) continue;

    db.insert(schema.newsArticles).values({
      externalId: a.externalId,
      source: a.source,
      sourceType: a.sourceType,
      title: a.title,
      summary: a.summary ?? null,
      url: a.url ?? null,
      publishedAt: a.publishedAt,
      relatedSymbols: JSON.stringify(a.relatedSymbols),
    }).run();
    inserted++;
  }
  return inserted;
}

export function getNewsArticlesSince(sinceISO: string) {
  return db.select().from(schema.newsArticles)
    .where(gte(schema.newsArticles.publishedAt, sinceISO))
    .orderBy(desc(schema.newsArticles.publishedAt))
    .all();
}

export function getExistingExternalIds(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  // Query in batches of 500 to avoid SQLite variable limit
  const result = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const rows = db.select({ externalId: schema.newsArticles.externalId })
      .from(schema.newsArticles)
      .where(inArray(schema.newsArticles.externalId, batch))
      .all();
    for (const r of rows) result.add(r.externalId);
  }
  return result;
}

export function updateNewsAnalysis(externalId: string, sentiment: string, impact: string, storyClusterId?: string, confidence?: string) {
  db.update(schema.newsArticles)
    .set({
      sentiment,
      impact,
      storyClusterId: storyClusterId ?? null,
      triangulationConfidence: confidence ?? null,
      analyzedAt: new Date().toISOString(),
    })
    .where(eq(schema.newsArticles.externalId, externalId))
    .run();
}

export function getNewsBodyByExternalId(externalId: string): { body: string | null; bodyFetchedAt: string | null } | null {
  const row = db.select({ body: schema.newsArticles.body, bodyFetchedAt: schema.newsArticles.bodyFetchedAt })
    .from(schema.newsArticles)
    .where(eq(schema.newsArticles.externalId, externalId))
    .get();
  return row ?? null;
}

export function getNewsBodiesByExternalIds(ids: string[]): Map<string, { body: string | null; bodyFetchedAt: string | null }> {
  const out = new Map<string, { body: string | null; bodyFetchedAt: string | null }>();
  if (ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const rows = db.select({
      externalId: schema.newsArticles.externalId,
      body: schema.newsArticles.body,
      bodyFetchedAt: schema.newsArticles.bodyFetchedAt,
    })
      .from(schema.newsArticles)
      .where(inArray(schema.newsArticles.externalId, batch))
      .all();
    for (const r of rows) out.set(r.externalId, { body: r.body, bodyFetchedAt: r.bodyFetchedAt });
  }
  return out;
}

export function updateNewsBody(externalId: string, body: string): void {
  db.update(schema.newsArticles)
    .set({ body, bodyFetchedAt: new Date().toISOString() })
    .where(eq(schema.newsArticles.externalId, externalId))
    .run();
}

// ==================== NEWS RADAR SNAPSHOTS ====================

export function insertNewsRadarSnapshot(data: {
  pipelineRunId?: number | null;
  totalNewsAnalyzed: number;
  perArticle: string;            // JSON
  aggregatedSignals: string;     // JSON
  emergingNarratives?: string;   // JSON
  llmModel?: string;
  durationMs?: number;
}) {
  return db.insert(schema.newsRadarSnapshots).values({
    pipelineRunId: data.pipelineRunId ?? null,
    totalNewsAnalyzed: data.totalNewsAnalyzed,
    perArticle: data.perArticle,
    aggregatedSignals: data.aggregatedSignals,
    emergingNarratives: data.emergingNarratives ?? null,
    llmModel: data.llmModel ?? null,
    durationMs: data.durationMs ?? null,
  }).run();
}

export function getLatestNewsRadarSnapshot() {
  return db.select().from(schema.newsRadarSnapshots)
    .orderBy(desc(schema.newsRadarSnapshots.generatedAt))
    .limit(1)
    .get();
}

export function getNewsRadarSnapshotsByDateRange(sinceISO: string, limit: number = 20) {
  return db.select().from(schema.newsRadarSnapshots)
    .where(gte(schema.newsRadarSnapshots.generatedAt, sinceISO))
    .orderBy(desc(schema.newsRadarSnapshots.generatedAt))
    .limit(limit)
    .all();
}

// ==================== NEWS INTELLIGENCE SNAPSHOTS ====================

export function insertNewsIntelligenceSnapshot(data: {
  totalNewsCount: number;
  plazas: string;              // JSON
  alerts: string;              // JSON
  topHeadlines?: string;       // JSON
  triangulationStats?: string; // JSON
}) {
  return db.insert(schema.newsIntelligenceSnapshots).values({
    totalNewsCount: data.totalNewsCount,
    plazas: data.plazas,
    alerts: data.alerts,
    topHeadlines: data.topHeadlines ?? null,
    triangulationStats: data.triangulationStats ?? null,
  }).run();
}

export function getLatestNewsIntelligenceSnapshot() {
  return db.select().from(schema.newsIntelligenceSnapshots)
    .orderBy(desc(schema.newsIntelligenceSnapshots.generatedAt))
    .limit(1)
    .get();
}

export function getNewsIntelligenceSnapshotsByDateRange(sinceISO: string, limit: number = 20) {
  return db.select().from(schema.newsIntelligenceSnapshots)
    .where(gte(schema.newsIntelligenceSnapshots.generatedAt, sinceISO))
    .orderBy(desc(schema.newsIntelligenceSnapshots.generatedAt))
    .limit(limit)
    .all();
}

// ==================== ANTI-HYPE REJECTIONS ====================

export function insertAntiHypeRejections(rejections: Array<{
  scanId?: number | null;
  symbol: string;
  reasons: string[];
  mode?: 'strict' | 'relaxed';
}>): void {
  if (rejections.length === 0) return;
  const rows = rejections.map(r => ({
    scanId: r.scanId ?? null,
    symbol: r.symbol,
    reasons: JSON.stringify(r.reasons),
    mode: r.mode ?? null,
  }));
  db.insert(schema.antiHypeRejections).values(rows).run();
}

export function getAntiHypeRejectionsForScan(scanId: number) {
  return db.select().from(schema.antiHypeRejections)
    .where(eq(schema.antiHypeRejections.scanId, scanId))
    .all()
    .map(r => ({ ...r, reasons: JSON.parse(r.reasons) as string[] }));
}

export function getRecentAntiHypeRejections(limit: number = 100) {
  return db.select().from(schema.antiHypeRejections)
    .orderBy(desc(schema.antiHypeRejections.rejectedAt))
    .limit(limit)
    .all()
    .map(r => ({ ...r, reasons: JSON.parse(r.reasons) as string[] }));
}

// ==================== SWING ALERTS ====================

export function insertSwingAlert(data: {
  symbol: string;
  alertType: string;
  direction: string;
  triggerDescription: string;
  triggerPercent: number;
  triggerPrice: number;
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  historicalWinRate: number;
  historicalAvgReturn: number;
  historicalSampleSize: number;
}) {
  return db.insert(schema.swingAlerts).values(data).run();
}

export function getActiveSwingAlerts() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.swingAlerts)
    .where(and(
      eq(schema.swingAlerts.status, 'active'),
      gte(schema.swingAlerts.createdAt, today),
    ))
    .orderBy(desc(schema.swingAlerts.id))
    .all();
}

export function getUnresolvedSwingAlerts() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.swingAlerts)
    .where(and(
      eq(schema.swingAlerts.status, 'active'),
    ))
    .all()
    .filter((a) => a.createdAt < today); // from previous days
}

export function resolveSwingAlert(id: number, data: {
  status: string;
  nextDayClose: number;
  nextDayChange: number;
}) {
  return db.update(schema.swingAlerts)
    .set({
      status: data.status,
      nextDayClose: data.nextDayClose,
      nextDayChange: data.nextDayChange,
      resolvedAt: new Date().toISOString(),
    })
    .where(eq(schema.swingAlerts.id, id))
    .run();
}

export function getSwingAlertHistory(limit: number = 50) {
  return db.select().from(schema.swingAlerts)
    .orderBy(desc(schema.swingAlerts.id))
    .limit(limit)
    .all();
}

export function getSwingAlertsBySymbolAndDate(symbol: string, date: string, alertType: string) {
  return db.select().from(schema.swingAlerts)
    .where(and(
      eq(schema.swingAlerts.symbol, symbol),
      eq(schema.swingAlerts.alertType, alertType),
      gte(schema.swingAlerts.createdAt, date),
    ))
    .all();
}

export function getResolvedAlerts(limit: number = 50) {
  return db.select().from(schema.swingAlerts)
    .orderBy(desc(schema.swingAlerts.id))
    .limit(limit)
    .all()
    .filter((a) => a.status !== 'active');
}

// ==================== ANTICIPATORY ALERTS ====================

function rowToAnticipatoryAlert(row: typeof schema.anticipatoryAlerts.$inferSelect): AnticipatoryAlert {
  return {
    id: row.id,
    kind: row.kind as AnticipatoryAlert['kind'],
    symbol: row.symbol,
    signals: JSON.parse(row.signals),
    currentPrice: row.currentPrice,
    entryPrice: row.entryPrice ?? undefined,
    stopLoss: row.stopLoss ?? undefined,
    takeProfit: row.takeProfit ?? undefined,
    score: row.score,
    status: row.status as AnticipatoryAlert['status'],
    firstSeenDate: row.firstSeenDate,
    lastSeenDate: row.lastSeenDate,
    seen: row.seen,
  };
}

export function getActiveAnticipatoryAlerts(): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .where(eq(schema.anticipatoryAlerts.status, 'active'))
    .orderBy(desc(schema.anticipatoryAlerts.lastSeenDate), desc(schema.anticipatoryAlerts.score))
    .all().map(rowToAnticipatoryAlert);
}

/** Watchlist de re-armado: solo kind='rearm' activas (no expiradas — el GC de 7 días ya las movió a 'expired'). */
export function getActiveRearmAlerts(): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .where(and(eq(schema.anticipatoryAlerts.kind, 'rearm'), eq(schema.anticipatoryAlerts.status, 'active')))
    .orderBy(desc(schema.anticipatoryAlerts.score))
    .all().map(rowToAnticipatoryAlert);
}

export function getRecentAnticipatoryAlerts(limit: number = 50): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .orderBy(desc(schema.anticipatoryAlerts.lastSeenDate), desc(schema.anticipatoryAlerts.createdAt))
    .limit(limit)
    .all().map(rowToAnticipatoryAlert);
}

export function upsertAnticipatoryAlerts(toInsert: AnticipatoryAlert[], toUpdate: AnticipatoryAlert[]): void {
  const now = new Date().toISOString();
  for (const a of toInsert) {
    // Contrato de ReconcileResult.toInsert: un id puede existir como expired/triggered
    // (re-alerta legitima tras expirar) → REACTIVAR con el episodio nuevo.
    db.insert(schema.anticipatoryAlerts).values({
      id: a.id, kind: a.kind, symbol: a.symbol, signals: JSON.stringify(a.signals),
      currentPrice: a.currentPrice, entryPrice: a.entryPrice ?? null,
      stopLoss: a.stopLoss ?? null, takeProfit: a.takeProfit ?? null,
      score: a.score, status: a.status,
      firstSeenDate: a.firstSeenDate, lastSeenDate: a.lastSeenDate,
      seen: a.seen, updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.anticipatoryAlerts.id,
      set: {
        kind: a.kind, symbol: a.symbol, signals: JSON.stringify(a.signals),
        currentPrice: a.currentPrice, entryPrice: a.entryPrice ?? null,
        stopLoss: a.stopLoss ?? null, takeProfit: a.takeProfit ?? null,
        score: a.score, status: 'active',
        firstSeenDate: a.firstSeenDate, lastSeenDate: a.lastSeenDate,
        seen: false, updatedAt: now,
        // Re-alerta tras expirar/resolver: el episodio nuevo arranca sin outcome,
        // para que el resolver lo mida de cero (si no, quedaría con el veredicto viejo).
        outcome: null, resolutionPrice: null, resolutionReturn: null, resolvedAt: null,
      },
    }).run();
  }
  for (const a of toUpdate) {
    db.update(schema.anticipatoryAlerts).set({
      signals: JSON.stringify(a.signals), currentPrice: a.currentPrice,
      entryPrice: a.entryPrice ?? null, stopLoss: a.stopLoss ?? null,
      takeProfit: a.takeProfit ?? null, score: a.score,
      lastSeenDate: a.lastSeenDate, updatedAt: now,
    }).where(eq(schema.anticipatoryAlerts.id, a.id)).run();
  }
}

export function expireAnticipatoryAlerts(ids: string[]): void {
  if (ids.length === 0) return;
  db.update(schema.anticipatoryAlerts)
    .set({ status: 'expired', updatedAt: new Date().toISOString() })
    .where(inArray(schema.anticipatoryAlerts.id, ids)).run();
}

/** Alertas anticipatorias sin outcome todavía — candidatas a resolución. */
export function getUnresolvedAnticipatoryAlerts(): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .where(and(eq(schema.anticipatoryAlerts.kind, 'anticipatory'), isNull(schema.anticipatoryAlerts.outcome)))
    .all().map(rowToAnticipatoryAlert);
}

/**
 * Persiste el veredicto de una alerta. status sigue el outcome para que la lista activa
 * (status='active') deje de mostrarla: triggered→'triggered', missed/expired→'expired'.
 */
export function resolveAnticipatoryAlert(
  id: string,
  data: { outcome: 'triggered' | 'missed' | 'expired'; resolutionPrice: number | null; resolutionReturn: number | null },
): void {
  const status = data.outcome === 'triggered' ? 'triggered' : 'expired';
  db.update(schema.anticipatoryAlerts).set({
    outcome: data.outcome,
    resolutionPrice: data.resolutionPrice,
    resolutionReturn: data.resolutionReturn,
    resolvedAt: new Date().toISOString(),
    status,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.anticipatoryAlerts.id, id)).run();
}

/** Accuracy de anticipación: ¿la movida alcista anticipada efectivamente ocurrió? */
export function getAnticipatoryAccuracyStats(): {
  resolved: number; triggered: number; missed: number; expired: number; hitRate: number; avgReturn: number;
} {
  const rows = db.select().from(schema.anticipatoryAlerts)
    .where(and(eq(schema.anticipatoryAlerts.kind, 'anticipatory'), inArray(schema.anticipatoryAlerts.outcome, ['triggered', 'missed', 'expired'])))
    .all();
  const triggered = rows.filter(r => r.outcome === 'triggered').length;
  const missed = rows.filter(r => r.outcome === 'missed').length;
  const expired = rows.filter(r => r.outcome === 'expired').length;
  const resolved = rows.length;
  // hitRate: de las que se resolvieron concluyentes (triggered+missed), cuántas dispararon.
  const conclusive = triggered + missed;
  const avgReturn = resolved > 0
    ? rows.reduce((s, r) => s + (r.resolutionReturn ?? 0), 0) / resolved : 0;
  return {
    resolved, triggered, missed, expired,
    hitRate: conclusive > 0 ? Math.round((triggered / conclusive) * 100) : 0,
    avgReturn: Math.round(avgReturn * 100) / 100,
  };
}

export function markAnticipatoryAlertsSeen(ids?: string[]): void {
  const now = new Date().toISOString();
  if (ids && ids.length > 0) {
    db.update(schema.anticipatoryAlerts).set({ seen: true, updatedAt: now })
      .where(inArray(schema.anticipatoryAlerts.id, ids)).run();
  } else {
    db.update(schema.anticipatoryAlerts).set({ seen: true, updatedAt: now })
      .where(eq(schema.anticipatoryAlerts.seen, false)).run();
  }
}

export function countUnseenAnticipatoryAlerts(): number {
  return db.select().from(schema.anticipatoryAlerts)
    .where(and(eq(schema.anticipatoryAlerts.seen, false), eq(schema.anticipatoryAlerts.status, 'active')))
    .all().length;
}

// ==================== DISCOVERED SYMBOLS ====================

export interface DiscoveredSymbolUpsertInput {
  symbol: string;
  name: string;
  instrumentType: string;
  sector: string;
  industry?: string | null;
  market: string;
  exchange?: string | null;
  discoveredFrom: string;
  relevanceScore?: number;
  expiresAt: string;
}

// Pura (sin I/O): payload del UPDATE al re-descubrir un símbolo.
// Refresca discoveredFrom (última fuente gana; la procedencia histórica queda en firstSeen)
// y el contexto de clasificación, que llega fresco de classifyAsset en cada llamada.
// El relevanceScore entrante actúa como piso del incremento (+10, cap 100): un
// re-descubrimiento por screener (30) levanta filas que quedaron en el fondo.
// Ojo: solo corre al reactivar una fila inactiva/expirada — las activas se filtran como known aguas arriba (registerNovelTickers).
export function buildDiscoveredSymbolUpdate(
  existing: { newsCount: number | null; relevanceScore: number | null },
  data: DiscoveredSymbolUpsertInput,
  now: string,
) {
  return {
    lastSeen: now,
    newsCount: (existing.newsCount ?? 0) + 1,
    relevanceScore: Math.min(100, Math.max((existing.relevanceScore ?? 0) + 10, data.relevanceScore ?? 0)),
    expiresAt: data.expiresAt,
    active: true,
    discoveredFrom: data.discoveredFrom,
    name: data.name,
    instrumentType: data.instrumentType,
    sector: data.sector,
    industry: data.industry ?? null,
    market: data.market,
    exchange: data.exchange ?? null,
  };
}

export function upsertDiscoveredSymbol(data: DiscoveredSymbolUpsertInput) {
  const existing = db.select().from(schema.discoveredSymbols)
    .where(eq(schema.discoveredSymbols.symbol, data.symbol))
    .get();

  if (existing) {
    return db.update(schema.discoveredSymbols)
      .set(buildDiscoveredSymbolUpdate(existing, data, new Date().toISOString()))
      .where(eq(schema.discoveredSymbols.symbol, data.symbol))
      .run();
  }

  return db.insert(schema.discoveredSymbols).values({
    ...data,
    industry: data.industry ?? null,
    exchange: data.exchange ?? null,
    relevanceScore: data.relevanceScore ?? 10,
  }).run();
}

export function getActiveDiscoveredSymbols() {
  const now = new Date().toISOString();
  return db.select().from(schema.discoveredSymbols)
    .where(and(
      eq(schema.discoveredSymbols.active, true),
      gt(schema.discoveredSymbols.expiresAt, now),
    ))
    .all();
}

/**
 * Soft TTL: only hard-deactivate symbols that expired AT LEAST 4 days ago.
 * Between day 14 (expiresAt) and day 18 (hard deactivate), the row stays
 * inactive for opportunity scans but is still findable by upsertDiscoveredSymbol,
 * which refreshes expiresAt back to +14 days on any news re-mention. This
 * prevents the "cliff" where a symbol vanishes mid-market-day and the user
 * loses 4-day-old context the moment news re-mentions it.
 */
const GRACE_PERIOD_DAYS = 4;

export function deactivateExpiredDiscoveries() {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const all = db.select().from(schema.discoveredSymbols)
    .where(eq(schema.discoveredSymbols.active, true))
    .all();

  let deactivated = 0;
  for (const s of all) {
    // Only deactivate if expired MORE than grace period ago
    if (s.expiresAt <= cutoff) {
      db.update(schema.discoveredSymbols)
        .set({ active: false })
        .where(eq(schema.discoveredSymbols.symbol, s.symbol))
        .run();
      deactivated++;
    }
  }
  return deactivated;
}

// ==================== SIGNAL TRACKING ====================

export function insertSignalTracking(data: {
  symbol: string;
  signalDate: string;
  action: string;
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  confidence: number;
  opportunityScore: number;
  // Dimension scores for accuracy analysis
  sector?: string | null;
  techScore?: number | null;
  fundScore?: number | null;
  sentScore?: number | null;
  hadDivergences?: boolean | null;
  enrichedByLlm?: boolean | null;
  shortTermScore?: number | null;
  mediumTermScore?: number | null;
  rsiAtSignal?: number | null;
  predictedReturnMid?: number | null;
  // Evidence V2 component scores
  peadScore?: number | null;
  insiderScore?: number | null;
  optionsScore?: number | null;
  activeSignalsCount?: number | null;
  marketRegimeAtSignal?: string | null;
  fundamentalsMultiplier?: number | null;
  beatPercent?: number | null;
  consecutiveBeats?: number | null;
  aiVerdict?: string | null;
  aiConfidence?: number | null;
  // A/B verdict tracking (algo vs LLM divergence resolution)
  algoAction?: string | null;
  llmAction?: string | null;
  verdictSource?: string | null;
  evidenceScore?: number | null;
  macroDelta?: number | null;
  // Setup quality (P1 clamp de riesgo) — true si el setup fue invalidado por riesgo > máximo
  setupInvalid?: boolean | null;
}) {
  // Atomic upsert: delete pending + insert new in single transaction
  return db.transaction((trx) => {
    trx.delete(schema.signalTracking)
      .where(and(
        eq(schema.signalTracking.symbol, data.symbol),
        eq(schema.signalTracking.signalDate, data.signalDate),
        eq(schema.signalTracking.outcome, 'pending'),
      ))
      .run();

    return trx.insert(schema.signalTracking).values({
      ...data,
      outcome: 'pending',
    }).run();
  });
}

export function updateSignalTargets(symbol: string, data: {
  targetPrice?: number;
  stopLoss?: number;
  confidence?: number;
  enrichedByLlm?: boolean;
  aiVerdict?: string;
  aiConfidence?: number;
}) {
  return db.update(schema.signalTracking)
    .set(data)
    .where(and(
      eq(schema.signalTracking.symbol, symbol),
      eq(schema.signalTracking.outcome, 'pending'),
      eq(schema.signalTracking.sector, 'evidence-v2'),
    ))
    .run();
}

export function getPendingSignals() {
  return db.select().from(schema.signalTracking)
    .where(eq(schema.signalTracking.outcome, 'pending'))
    .all();
}

export function resolveSignal(id: number, data: {
  priceAfter7d?: number | null;
  priceAfter30d?: number | null;
  returnAfter7d?: number | null;
  returnAfter30d?: number | null;
  hitTarget?: boolean | null;
  hitStop?: boolean | null;
  outcome: string;
  rMultiple?: number | null;
}) {
  return db.update(schema.signalTracking)
    .set({ ...data, resolvedAt: new Date().toISOString() })
    .where(eq(schema.signalTracking.id, id))
    .run();
}

export function getSignalTrackingHistory(limit: number = 100) {
  return db.select().from(schema.signalTracking)
    .orderBy(desc(schema.signalTracking.id))
    .limit(limit)
    .all();
}

/** Fila mínima necesaria para segmentar por riesgo del stop (subconjunto de signalTracking). */
export interface StopRiskRow {
  entryPrice: number;
  stopLoss: number | null;
  rMultiple: number | null;
}

/**
 * Segmenta filas resueltas en "clean" (stop dentro del riesgo máximo tolerable — el mundo
 * post-clamp del P1) y "legacy" (stop >MAX_SETUP_RISK_PCT% del entry — señales pre-clamp).
 * Mezclar ambas poblaciones comprime el expectancy promedio hacia 0: medido en el review del
 * P1, 50.3% de las filas históricas tienen stop >10% con +0.032R clean vs -0.018R legacy.
 *
 * Decisión sobre stop null: se clasifica como "legacy", no se excluye. No hay evidencia de que
 * ese trade respetara el límite de riesgo (no se puede afirmar "clean" sin nivel), y de todos
 * modos no contamina el expectancy — `rMultiple` requiere `stopLoss` no-null
 * (ver computeRMultiple en outcome-resolver.ts), así que una fila con stop null nunca aporta a
 * `rCleanN` ni a `rLegacyN`; solo determina en qué bucket se cuenta si en el futuro se agregan
 * métricas no-R sobre estos grupos.
 */
export function segmentByStopRisk<T extends StopRiskRow>(
  rows: T[],
  maxRiskPct: number = envNumber('MAX_SETUP_RISK_PCT', 10),
): { clean: T[]; legacy: T[] } {
  const clean: T[] = [];
  const legacy: T[] = [];
  for (const row of rows) {
    const riskPct = row.stopLoss != null && row.entryPrice > 0
      ? (Math.abs(row.entryPrice - row.stopLoss) / row.entryPrice) * 100
      : null;
    if (riskPct != null && riskPct <= maxRiskPct) {
      clean.push(row);
    } else {
      legacy.push(row);
    }
  }
  return { clean, legacy };
}

/** Expectancy (avgR redondeado a 2 decimales) + N sobre filas con rMultiple calculable. */
export function computeExpectancy(rows: Array<{ rMultiple: number | null }>): { avg: number; n: number } {
  const rValues = rows.map(r => r.rMultiple).filter((r): r is number => r != null);
  const n = rValues.length;
  const avg = n > 0 ? Math.round((rValues.reduce((sum, r) => sum + r, 0) / n) * 100) / 100 : 0;
  return { avg, n };
}

export function getSignalAccuracyStats() {
  const all = db.select().from(schema.signalTracking)
    .where(
      and(
        inArray(schema.signalTracking.outcome, ['win', 'loss', 'neutral']),
        inArray(schema.signalTracking.action, ['BUY', 'SELL']),
      ),
    )
    .all();

  const total = all.length;
  const wins = all.filter(s => s.outcome === 'win').length;
  const losses = all.filter(s => s.outcome === 'loss').length;
  const neutrals = all.filter(s => s.outcome === 'neutral').length;
  const avgReturn7d = total > 0
    ? all.reduce((sum, s) => sum + (s.returnAfter7d ?? 0), 0) / total
    : 0;
  const avgReturn30d = total > 0
    ? all.reduce((sum, s) => sum + (s.returnAfter30d ?? 0), 0) / total
    : 0;

  // R-múltiplo: expectancy real del sistema, medida en unidades de riesgo asumido.
  // Solo cuenta filas con rMultiple calculable (requiere stop válido); no todas las
  // señales resueltas lo tienen, por eso el sample size es independiente de `total`.
  const rValues = all.map(s => s.rMultiple).filter((r): r is number => r != null);
  const rSampleSize = rValues.length;
  const avgR = rSampleSize > 0
    ? Math.round((rValues.reduce((sum, r) => sum + r, 0) / rSampleSize) * 100) / 100
    : 0;

  // Expectancy segmentada: separa setups "clean" (stop dentro del riesgo máximo del P1) de
  // "legacy" (stop pre-clamp) — el global de arriba mezcla ambas poblaciones y comprime el
  // promedio hacia 0 (ver segmentByStopRisk para el detalle).
  const { clean, legacy } = segmentByStopRisk(all);
  const cleanExpectancy = computeExpectancy(clean);
  const legacyExpectancy = computeExpectancy(legacy);

  return {
    total,
    wins,
    losses,
    neutrals,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    avgReturn7d: Math.round(avgReturn7d * 100) / 100,
    avgReturn30d: Math.round(avgReturn30d * 100) / 100,
    avgR,
    expectancyR: avgR,
    rSampleSize,
    expectancyRClean: cleanExpectancy.avg,
    rCleanN: cleanExpectancy.n,
    expectancyRLegacy: legacyExpectancy.avg,
    rLegacyN: legacyExpectancy.n,
  };
}

export function getAccuracyBySector(): Array<{ sector: string; total: number; wins: number; losses: number; winRate: number; avgReturn7d: number }> {
  const rows = db.select({
    sector: signalTracking.sector,
    total: sql<number>`count(*)`,
    wins: sql<number>`sum(case when ${signalTracking.outcome} = 'win' then 1 else 0 end)`,
    losses: sql<number>`sum(case when ${signalTracking.outcome} = 'loss' then 1 else 0 end)`,
    avgReturn7d: sql<number>`avg(${signalTracking.returnAfter7d})`,
  })
  .from(signalTracking)
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.outcome} != 'invalid' AND ${signalTracking.sector} IS NOT NULL`)
  .groupBy(signalTracking.sector)
  .all();

  return rows.map(r => ({
    sector: r.sector ?? 'unknown',
    total: Number(r.total),
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    winRate: r.total > 0 ? Math.round((Number(r.wins ?? 0) / Number(r.total)) * 100 * 10) / 10 : 0,
    avgReturn7d: Math.round((Number(r.avgReturn7d ?? 0)) * 100) / 100,
  }));
}

export function getAccuracyByConfidenceTier(): Array<{ tier: string; total: number; wins: number; winRate: number; avgReturn7d: number }> {
  const rows = db.select({
    tier: sql<string>`case when ${signalTracking.confidence} >= 70 then 'high' when ${signalTracking.confidence} >= 50 then 'medium' else 'low' end`,
    total: sql<number>`count(*)`,
    wins: sql<number>`sum(case when ${signalTracking.outcome} = 'win' then 1 else 0 end)`,
    avgReturn7d: sql<number>`avg(${signalTracking.returnAfter7d})`,
  })
  .from(signalTracking)
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.outcome} != 'invalid'`)
  .groupBy(sql`case when ${signalTracking.confidence} >= 70 then 'high' when ${signalTracking.confidence} >= 50 then 'medium' else 'low' end`)
  .all();

  return rows.map(r => ({
    tier: r.tier ?? 'unknown',
    total: Number(r.total),
    wins: Number(r.wins ?? 0),
    winRate: r.total > 0 ? Math.round((Number(r.wins ?? 0) / Number(r.total)) * 100 * 10) / 10 : 0,
    avgReturn7d: Math.round((Number(r.avgReturn7d ?? 0)) * 100) / 100,
  }));
}

export function getAccuracyByScoreRange(): Array<{ range: string; total: number; wins: number; winRate: number; avgReturn7d: number }> {
  const rows = db.select({
    range: sql<string>`case when ${signalTracking.opportunityScore} >= 72 then '72+' when ${signalTracking.opportunityScore} >= 62 then '62-71' when ${signalTracking.opportunityScore} >= 52 then '52-61' else '<52' end`,
    total: sql<number>`count(*)`,
    wins: sql<number>`sum(case when ${signalTracking.outcome} = 'win' then 1 else 0 end)`,
    avgReturn7d: sql<number>`avg(${signalTracking.returnAfter7d})`,
  })
  .from(signalTracking)
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.outcome} != 'invalid'`)
  .groupBy(sql`case when ${signalTracking.opportunityScore} >= 72 then '72+' when ${signalTracking.opportunityScore} >= 62 then '62-71' when ${signalTracking.opportunityScore} >= 52 then '52-61' else '<52' end`)
  .all();

  return rows.map(r => ({
    range: r.range ?? 'unknown',
    total: Number(r.total),
    wins: Number(r.wins ?? 0),
    winRate: r.total > 0 ? Math.round((Number(r.wins ?? 0) / Number(r.total)) * 100 * 10) / 10 : 0,
    avgReturn7d: Math.round((Number(r.avgReturn7d ?? 0)) * 100) / 100,
  }));
}

export function getDimensionCorrelation(): { techAccuracy: number; fundAccuracy: number; sentAccuracy: number; total: number } {
  const rows = db.select({
    techScore: signalTracking.techScore,
    fundScore: signalTracking.fundScore,
    sentScore: signalTracking.sentScore,
    returnAfter7d: signalTracking.returnAfter7d,
  })
  .from(signalTracking)
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.outcome} != 'invalid' AND ${signalTracking.techScore} IS NOT NULL`)
  .all();

  let techCorrect = 0, fundCorrect = 0, sentCorrect = 0, total = 0;
  for (const r of rows) {
    const ret = r.returnAfter7d ?? 0;
    total++;
    if ((r.techScore ?? 0) > 0 && ret > 0 || (r.techScore ?? 0) < 0 && ret < 0) techCorrect++;
    if ((r.fundScore ?? 0) > 0 && ret > 0 || (r.fundScore ?? 0) < 0 && ret < 0) fundCorrect++;
    if ((r.sentScore ?? 0) > 0 && ret > 0 || (r.sentScore ?? 0) < 0 && ret < 0) sentCorrect++;
  }

  return {
    techAccuracy: total > 0 ? Math.round((techCorrect / total) * 100 * 10) / 10 : 0,
    fundAccuracy: total > 0 ? Math.round((fundCorrect / total) * 100 * 10) / 10 : 0,
    sentAccuracy: total > 0 ? Math.round((sentCorrect / total) * 100 * 10) / 10 : 0,
    total,
  };
}

export function getEstimateAccuracy(): { avgBias: number; avgAbsError: number; total: number } {
  const rows = db.select({
    predicted: signalTracking.predictedReturnMid,
    actual: signalTracking.returnAfter7d,
  })
  .from(signalTracking)
  .where(sql`${signalTracking.predictedReturnMid} IS NOT NULL AND ${signalTracking.returnAfter7d} IS NOT NULL`)
  .all();

  if (rows.length === 0) return { avgBias: 0, avgAbsError: 0, total: 0 };

  let totalBias = 0, totalAbsError = 0;
  for (const r of rows) {
    const bias = (r.predicted ?? 0) - (r.actual ?? 0);
    totalBias += bias;
    totalAbsError += Math.abs(bias);
  }

  return {
    avgBias: Math.round((totalBias / rows.length) * 100) / 100,
    avgAbsError: Math.round((totalAbsError / rows.length) * 100) / 100,
    total: rows.length,
  };
}

// --- Missed opportunities ---

export function insertMissedOpportunity(data: {
  symbol: string; scanDate: string; actionGiven: string;
  opportunityScore: number; actualReturn7d: number | null;
  actualReturn30d: number | null; wouldHaveBeen: string | null;
}): void {
  db.insert(missedOpportunities).values(data).run();
}

export function getMissedOpportunities(limit = 50): Array<any> {
  return db.select().from(missedOpportunities).orderBy(sql`${missedOpportunities.createdAt} DESC`).limit(limit).all();
}

// ==================== HISTORICAL PRICE CACHE ====================

export function getHistoricalFromCache(symbol: string, interval: 'daily' | 'weekly'): string | null {
  const id = `${symbol}:${interval}`;
  const now = new Date().toISOString();
  const row = db.select().from(schema.historicalCache)
    .where(eq(schema.historicalCache.id, id))
    .get();
  if (!row || row.expiresAt <= now) return null;
  return row.data;
}

export function upsertHistoricalCache(symbol: string, interval: 'daily' | 'weekly', data: string) {
  const id = `${symbol}:${interval}`;
  const now = new Date();
  // Daily expires end of day, weekly expires in 7 days
  const ttlMs = interval === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const expires = new Date(now.getTime() + ttlMs);

  const existing = db.select().from(schema.historicalCache)
    .where(eq(schema.historicalCache.id, id))
    .get();

  if (existing) {
    db.update(schema.historicalCache)
      .set({ data, fetchedAt: now.toISOString(), expiresAt: expires.toISOString() })
      .where(eq(schema.historicalCache.id, id))
      .run();
  } else {
    db.insert(schema.historicalCache).values({
      id, symbol, interval, data,
      fetchedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }).run();
  }
}

// ==================== FUNDAMENTAL CACHE ====================

export function getFundamentalFromCache(symbol: string): string | null {
  const now = new Date().toISOString();
  const row = db.select().from(schema.fundamentalCache)
    .where(eq(schema.fundamentalCache.symbol, symbol))
    .get();
  if (!row || row.expiresAt <= now) return null;
  return row.data;
}

export function getFundamentalCacheRaw(symbol: string): { data: string; fetchedAt: string; expiresAt: string } | null {
  const row = db.select().from(schema.fundamentalCache).where(eq(schema.fundamentalCache.symbol, symbol)).get();
  if (!row) return null;
  return { data: row.data, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt };
}

export function upsertFundamentalCache(symbol: string, data: string) {
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const existing = db.select().from(schema.fundamentalCache)
    .where(eq(schema.fundamentalCache.symbol, symbol))
    .get();
  if (existing) {
    db.update(schema.fundamentalCache)
      .set({ data, fetchedAt: now.toISOString(), expiresAt: expires.toISOString() })
      .where(eq(schema.fundamentalCache.symbol, symbol))
      .run();
  } else {
    db.insert(schema.fundamentalCache).values({
      symbol, data, fetchedAt: now.toISOString(), expiresAt: expires.toISOString(),
    }).run();
  }
}

export function getAllFundamentalCache(): Array<{ symbol: string; data: string; fetchedAt: string }> {
  const now = new Date().toISOString();
  return db.select().from(schema.fundamentalCache)
    .all()
    .filter(r => r.expiresAt > now);
}

export function getFundamentalCacheAge(): string | null {
  const row = db.select({ fetchedAt: schema.fundamentalCache.fetchedAt })
    .from(schema.fundamentalCache)
    .orderBy(desc(schema.fundamentalCache.fetchedAt))
    .limit(1)
    .get();
  if (!row?.fetchedAt) return null;
  const ts = row.fetchedAt;
  return ts.endsWith('Z') ? ts : ts + 'Z';
}

// ==================== SECTOR IMPACTS ====================

export function deleteSectorImpactsByDate(date: string) {
  db.delete(schema.sectorImpacts)
    .where(eq(schema.sectorImpacts.reportDate, date))
    .run();
}

export function insertSectorImpacts(date: string, impacts: Array<{
  sector: string;
  impact: string;
  event: string;
  summary: string;
  keyNews: string[];
  suggestedTickers: string[];
  riskFactors: string[];
  catalysts?: string[];
  conviccion?: string;
  tension?: string | null;
  confidence: string;
}>) {
  for (const i of impacts) {
    db.insert(schema.sectorImpacts).values({
      reportDate: date,
      sector: i.sector,
      impact: i.impact,
      event: i.event,
      summary: i.summary,
      keyNews: JSON.stringify(i.keyNews),
      suggestedTickers: JSON.stringify(i.suggestedTickers),
      riskFactors: JSON.stringify(i.riskFactors),
      catalysts: JSON.stringify(i.catalysts ?? []),
      conviccion: i.conviccion ?? 'media',
      tension: i.tension ?? null,
      confidence: i.confidence,
    }).run();
  }
}

export function getSectorImpactsByDate(date: string) {
  return db.select().from(schema.sectorImpacts)
    .where(eq(schema.sectorImpacts.reportDate, date))
    .all()
    .map(r => ({
      ...r,
      keyNews: JSON.parse(r.keyNews) as string[],
      suggestedTickers: JSON.parse(r.suggestedTickers) as string[],
      riskFactors: JSON.parse(r.riskFactors) as string[],
      catalysts: JSON.parse(r.catalysts ?? '[]') as string[],
    }));
}

export function getLatestSectorImpacts() {
  const today = new Date().toISOString().split('T')[0];
  return getSectorImpactsByDate(today);
}

export function getFilteredArticlesForSectorSynthesis(limit = 60) {
  return db.select({
    title: schema.newsArticles.title,
    summary: schema.newsArticles.summary,
    sentiment: schema.newsArticles.sentiment,
    impact: schema.newsArticles.impact,
    triangulationConfidence: schema.newsArticles.triangulationConfidence,
    source: schema.newsArticles.source,
  })
    .from(schema.newsArticles)
    .where(
      inArray(schema.newsArticles.triangulationConfidence, ['high', 'medium'])
    )
    .orderBy(desc(schema.newsArticles.createdAt))
    .limit(limit)
    .all();
}

export function getNewsCacheAge(): string | null {
  const row = db.select({ createdAt: schema.newsArticles.createdAt })
    .from(schema.newsArticles)
    .orderBy(desc(schema.newsArticles.createdAt))
    .limit(1)
    .get();
  if (!row?.createdAt) return null;
  // SQLite stores without timezone — append Z so JS parses as UTC
  const ts = row.createdAt;
  return ts.endsWith('Z') ? ts : ts + 'Z';
}

// ==================== CONFIG TABLES ====================

export function getActiveMarketThemes() {
  return db.select().from(schema.marketThemes)
    .where(eq(schema.marketThemes.active, true))
    .all();
}

export function getActiveNewsSources(type?: 'rss' | 'newsapi' | 'finnhub') {
  if (type) {
    return db.select().from(schema.newsSources)
      .where(and(eq(schema.newsSources.active, true), eq(schema.newsSources.type, type)))
      .orderBy(schema.newsSources.priority)
      .all();
  }
  return db.select().from(schema.newsSources)
    .where(eq(schema.newsSources.active, true))
    .orderBy(schema.newsSources.priority)
    .all();
}

export function getActiveNewsSearchKeywords() {
  return db.select().from(schema.newsSearchKeywords)
    .where(eq(schema.newsSearchKeywords.active, true))
    .orderBy(schema.newsSearchKeywords.priority)
    .all();
}

export function getActiveSentimentKeywords() {
  return db.select().from(schema.sentimentKeywords)
    .where(eq(schema.sentimentKeywords.active, true))
    .all();
}

export function getSectorTickersBySector(sector: string) {
  return db.select().from(schema.sectorTickers)
    .where(eq(schema.sectorTickers.sector, sector))
    .orderBy(desc(schema.sectorTickers.weight))
    .all();
}

export function getAllSectorTickers() {
  return db.select().from(schema.sectorTickers).all();
}

export function getSymbolsByType(type: 'adr' | 'us' | 'crypto') {
  return db.select().from(schema.symbols)
    .where(and(eq(schema.symbols.type, type), eq(schema.symbols.active, true)))
    .all();
}

export function getSymbolsByMarket(market: string) {
  const argPlazas = ['argentina-energy', 'argentina-finance', 'argentina-cedears'];
  return db.select().from(schema.symbols)
    .where(eq(schema.symbols.active, true))
    .all()
    .filter(s => market === 'argentina'
      ? argPlazas.includes(s.plaza)
      : !argPlazas.includes(s.plaza));
}

export function getNewsArticlesForToday(minImpact?: 'high' | 'medium') {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.select().from(schema.newsArticles)
    .where(gte(schema.newsArticles.publishedAt, today))
    .orderBy(desc(schema.newsArticles.publishedAt))
    .all();
  if (!minImpact) return rows;
  const order: Record<string, number> = { high: 2, medium: 1, low: 0 };
  const minLevel = order[minImpact] ?? 0;
  return rows.filter(r => {
    const level = order[(r.impact ?? 'low')] ?? 0;
    return level >= minLevel;
  });
}

export function getSectorImpactsForToday() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.sectorImpacts)
    .where(eq(schema.sectorImpacts.reportDate, today))
    .all();
}

export function getOpportunitySnapshotsForLatestScan() {
  const latestScan = db.select().from(schema.opportunityScans)
    .orderBy(desc(schema.opportunityScans.createdAt))
    .get();
  if (!latestScan) return [];
  return db.select().from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.scanId, latestScan.id))
    .all();
}

export function updateOpportunityScanStatus(scanId: number, status: 'ok' | 'partial' | 'failed') {
  return db.update(schema.opportunityScans)
    .set({ status } as any)
    .where(eq(schema.opportunityScans.id, scanId))
    .run();
}

export function getTodayOpportunityScan() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.opportunityScans)
    .where(gte(schema.opportunityScans.scannedAt, today))
    .orderBy(desc(schema.opportunityScans.createdAt))
    .get();
}

// ==================== MARKET DIGESTS ====================

export function getMarketDigestByDate(date: string): string | null {
  const row = db.select().from(schema.marketDigests)
    .where(eq(schema.marketDigests.reportDate, date))
    .get();
  return row?.digest ?? null;
}

export function upsertMarketDigest(date: string, digest: string) {
  const existing = db.select().from(schema.marketDigests)
    .where(eq(schema.marketDigests.reportDate, date))
    .get();
  const now = new Date().toISOString();
  if (existing) {
    db.update(schema.marketDigests)
      .set({ digest, updatedAt: now })
      .where(eq(schema.marketDigests.reportDate, date))
      .run();
  } else {
    db.insert(schema.marketDigests).values({ reportDate: date, digest, createdAt: now, updatedAt: now }).run();
  }
}

// ==================== WEB SEARCH ARTICLES ====================

export function insertWebSearchArticles(articles: Array<{
  date: string;
  symbol: string | null;
  query: string;
  layer: 'portfolio' | 'discovery';
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
  relatedSymbols: string[];
}>) {
  if (articles.length === 0) return;
  db.insert(schema.webSearchArticles).values(
    articles.map((a) => ({
      date: a.date,
      symbol: a.symbol ?? null,
      query: a.query,
      layer: a.layer,
      title: a.title,
      url: a.url,
      content: a.content,
      publishedAt: a.publishedAt ?? null,
      relatedSymbols: JSON.stringify(a.relatedSymbols),
    })),
  ).run();
}

export function getWebSearchArticlesForDate(date: string) {
  return db.select().from(schema.webSearchArticles)
    .where(eq(schema.webSearchArticles.date, date))
    .all()
    .map((row) => ({
      ...row,
      relatedSymbols: JSON.parse(row.relatedSymbols) as string[],
    }));
}

// ==================== EVIDENCE SIGNALS SNAPSHOTS ====================

export function insertEvidenceSignalsSnapshot(data: {
  scanDate: string;
  scannedAt: string;
  signals: string;
  analyses: string;
  marketRegime: string | null;
  totalSymbols: number;
  highConviction: number;
  mediumConviction: number;
  withSignals: number;
}) {
  return db.insert(schema.evidenceSignalsSnapshots).values(data).run();
}

export function getEvidenceSnapshotDates(): string[] {
  return db.selectDistinct({ date: schema.evidenceSignalsSnapshots.scanDate })
    .from(schema.evidenceSignalsSnapshots)
    .orderBy(desc(schema.evidenceSignalsSnapshots.scanDate))
    .all()
    .map(r => r.date);
}

export function getEvidenceSnapshotByDate(date: string) {
  return db.select().from(schema.evidenceSignalsSnapshots)
    .where(eq(schema.evidenceSignalsSnapshots.scanDate, date))
    .orderBy(desc(schema.evidenceSignalsSnapshots.id))
    .limit(1)
    .get();
}

// ─── Causal Map ───────────────────────────────────────────────────────────────

export interface CausalChainRow {
  eventId: string;
  ticker: string;
  category: string;
  direction: 'positive' | 'negative';
  impact: 'direct' | 'indirect';
  reason: string;
}

export interface MacroEventRow {
  eventId: string;
  event: string;
  category: string;
  magnitude: 'high' | 'medium' | 'low';
  relatedEventIds: string[];
  chains: CausalChainRow[];
}

export function clearCausalMapForDate(date: string): void {
  db.delete(schema.eventRelations).where(eq(schema.eventRelations.date, date)).run();
  db.delete(schema.causalChains).where(eq(schema.causalChains.date, date)).run();
  db.delete(schema.macroEvents).where(eq(schema.macroEvents.date, date)).run();
}

export function saveCausalMap(date: string, events: MacroEventRow[]): void {
  db.transaction((trx) => {
    // Clear first, inside the same transaction
    trx.delete(schema.eventRelations).where(eq(schema.eventRelations.date, date)).run();
    trx.delete(schema.causalChains).where(eq(schema.causalChains.date, date)).run();
    trx.delete(schema.macroEvents).where(eq(schema.macroEvents.date, date)).run();
    // Then insert
    for (const evt of events) {
      trx.insert(schema.macroEvents).values({
        date,
        eventId: evt.eventId,
        event: evt.event,
        category: evt.category,
        magnitude: evt.magnitude,
      }).run();
      for (const chain of evt.chains) {
        trx.insert(schema.causalChains).values({
          date,
          eventId: evt.eventId,
          ticker: chain.ticker,
          category: chain.category,
          direction: chain.direction,
          impact: chain.impact,
          reason: chain.reason,
        }).run();
      }
      for (const relId of evt.relatedEventIds) {
        trx.insert(schema.eventRelations).values({
          date,
          eventId: evt.eventId,
          relatedEventId: relId,
        }).run();
      }
    }
  });
}

export function getCausalMapByDate(date: string): MacroEventRow[] {
  const events = db.select().from(schema.macroEvents)
    .where(eq(schema.macroEvents.date, date))
    .all();
  const chains = db.select().from(schema.causalChains)
    .where(eq(schema.causalChains.date, date))
    .all();
  const relations = db.select().from(schema.eventRelations)
    .where(eq(schema.eventRelations.date, date))
    .all();

  return events.map(evt => ({
    eventId: evt.eventId,
    event: evt.event,
    category: evt.category,
    magnitude: evt.magnitude as 'high' | 'medium' | 'low',
    relatedEventIds: relations
      .filter(r => r.eventId === evt.eventId)
      .map(r => r.relatedEventId),
    chains: chains
      .filter(c => c.eventId === evt.eventId)
      .map(c => ({
        eventId: c.eventId,
        ticker: c.ticker,
        category: c.category,
        direction: c.direction as 'positive' | 'negative',
        impact: c.impact as 'direct' | 'indirect',
        reason: c.reason,
      })),
  }));
}

export function getCausalTickersByDate(date: string): Array<{ ticker: string; direction: 'positive' | 'negative'; causalSummary: string }> {
  const chains = db.select().from(schema.causalChains)
    .where(eq(schema.causalChains.date, date))
    .all();
  const events = db.select().from(schema.macroEvents)
    .where(eq(schema.macroEvents.date, date))
    .all();
  const eventMap = new Map(events.map(e => [e.eventId, e]));

  // Deduplicate: one entry per ticker, strongest direction wins, accumulate reasons
  const tickerMap = new Map<string, { direction: 'positive' | 'negative'; reasons: string[] }>();
  for (const chain of chains) {
    const evt = eventMap.get(chain.eventId);
    const reason = `[${chain.impact === 'direct' ? 'DIRECTO' : 'INDIRECTO'}] ${evt?.event ?? chain.eventId}: ${chain.reason}`;
    if (!tickerMap.has(chain.ticker)) {
      tickerMap.set(chain.ticker, { direction: chain.direction as 'positive' | 'negative', reasons: [reason] });
    } else {
      const entry = tickerMap.get(chain.ticker)!;
      if (chain.direction === 'positive' && entry.direction === 'negative') {
        entry.direction = 'positive'; // positive overrides negative
      }
      entry.reasons.push(reason);
    }
  }

  return [...tickerMap.entries()].map(([ticker, data]) => ({
    ticker,
    direction: data.direction,
    causalSummary: data.reasons.join('\n'),
  }));
}

export interface UnresolvedCausalChain {
  id: number;
  date: string;
  ticker: string;
  direction: 'positive' | 'negative';
}

/** Cadenas causales sin outcome cuyo evento ya tiene al menos `minAgeDays` de antigüedad. */
export function getUnresolvedCausalChains(asOfDate: string, minAgeDays: number): UnresolvedCausalChain[] {
  const cutoff = new Date(Date.parse(asOfDate) - minAgeDays * 86_400_000).toISOString().slice(0, 10);
  return db.select({
    id: schema.causalChains.id,
    date: schema.causalChains.date,
    ticker: schema.causalChains.ticker,
    direction: schema.causalChains.direction,
  }).from(schema.causalChains)
    .where(and(isNull(schema.causalChains.outcome), lt(schema.causalChains.date, cutoff)))
    .all() as UnresolvedCausalChain[];
}

export function resolveCausalChain(
  id: number,
  data: { entryPrice: number; resolutionPrice: number | null; resolutionReturn: number | null; outcome: 'correct' | 'incorrect' | 'neutral' },
): void {
  db.update(schema.causalChains).set({
    entryPrice: data.entryPrice,
    resolutionPrice: data.resolutionPrice,
    resolutionReturn: data.resolutionReturn,
    outcome: data.outcome,
    resolvedAt: new Date().toISOString(),
  }).where(eq(schema.causalChains.id, id)).run();
}

/** Accuracy de las cadenas causales: ¿la dirección predicha por la noticia acertó? */
export function getCausalAccuracyStats(): {
  resolved: number; correct: number; incorrect: number; neutral: number; accuracy: number;
  byDirection: { positive: { resolved: number; correct: number }; negative: { resolved: number; correct: number } };
} {
  const rows = db.select({
    direction: schema.causalChains.direction,
    outcome: schema.causalChains.outcome,
  }).from(schema.causalChains)
    .where(inArray(schema.causalChains.outcome, ['correct', 'incorrect', 'neutral']))
    .all();

  const correct = rows.filter(r => r.outcome === 'correct').length;
  const incorrect = rows.filter(r => r.outcome === 'incorrect').length;
  const neutral = rows.filter(r => r.outcome === 'neutral').length;
  // accuracy: sobre las concluyentes (correct+incorrect), excluye neutral (sin movida).
  const conclusive = correct + incorrect;
  const dir = (d: 'positive' | 'negative') => {
    const sub = rows.filter(r => r.direction === d && r.outcome !== 'neutral');
    return { resolved: sub.length, correct: sub.filter(r => r.outcome === 'correct').length };
  };
  return {
    resolved: rows.length, correct, incorrect, neutral,
    accuracy: conclusive > 0 ? Math.round((correct / conclusive) * 100) : 0,
    byDirection: { positive: dir('positive'), negative: dir('negative') },
  };
}

// ─── ETF Watchlist ────────────────────────────────────────────────────────────

export interface EtfWatchlistEntry {
  id: number;
  symbol: string;
  name: string;
  category: 'indices' | 'sectores' | 'bonos' | 'commodities' | 'latam' | 'internacional' | 'crypto' | 'factor';
  description: string | null;
  active: boolean;
  createdAt: string;
}

export function getEtfWatchlist(): EtfWatchlistEntry[] {
  return db.select().from(etfWatchlist).where(eq(etfWatchlist.active, true)).all() as EtfWatchlistEntry[];
}

export function getEtfSymbols(): string[] {
  return getEtfWatchlist().map((e) => e.symbol);
}

export function addEtfToWatchlist(
  symbol: string,
  name: string,
  category: EtfWatchlistEntry['category'],
  description?: string,
): void {
  db.insert(etfWatchlist).values({ symbol: symbol.toUpperCase(), name, category, description: description ?? null }).run();
}

export function removeEtfFromWatchlist(symbol: string): void {
  db.update(etfWatchlist).set({ active: false }).where(eq(etfWatchlist.symbol, symbol.toUpperCase())).run();
}

// ==================== EVENT STUDY (playbook empírico) ====================

export interface EventReactionRow {
  eventType: string;
  target: string;
  horizonDays: number;
  reactionAvg: number;
  baselineAvg: number;
  edge: number;
  winRate: number;
  tStat: number;
  significant: boolean;
  nEvents: number;
}

/** Reemplaza el playbook completo (es un recálculo, no un incremento). */
export function replaceEventReactions(rows: EventReactionRow[]): void {
  db.delete(schema.eventSectorReactions).run();
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  for (const r of rows) {
    db.insert(schema.eventSectorReactions).values({ ...r, computedAt: now }).run();
  }
}

export function getEventReactions(eventType?: string): EventReactionRow[] {
  const q = db.select().from(schema.eventSectorReactions);
  const rows = eventType
    ? q.where(eq(schema.eventSectorReactions.eventType, eventType)).all()
    : q.all();
  return rows.map((r) => ({
    eventType: r.eventType, target: r.target, horizonDays: r.horizonDays,
    reactionAvg: r.reactionAvg, baselineAvg: r.baselineAvg, edge: r.edge,
    winRate: r.winRate, tStat: r.tStat, significant: r.significant, nEvents: r.nEvents,
  }));
}

// ---------------------------------------------------------------------------
// Watchlist lifecycle — le da lado de cierre al watchlist `symbols`.
// ---------------------------------------------------------------------------

export type WatchlistItemRow = typeof schema.watchlistItems.$inferSelect;

export function insertWatchlistItem(data: {
  symbol: string;
  addedAt: string;
  source: 'recommendation' | 'manual';
  entryPrice: number;
  entryAction: string;
  entryScore?: number | null;
  entryConfidence?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  thesis?: string | null;
  horizonDays?: number;
}) {
  return db.insert(schema.watchlistItems).values({
    ...data,
    status: 'live',
  }).run();
}

/** Item activo (no archivado/resuelto) más reciente para un símbolo, o undefined. */
export function getOpenWatchlistItem(symbol: string): WatchlistItemRow | undefined {
  return db.select().from(schema.watchlistItems)
    .where(and(
      eq(schema.watchlistItems.symbol, symbol),
      eq(schema.watchlistItems.status, 'live'),
    ))
    .orderBy(desc(schema.watchlistItems.id))
    .limit(1)
    .all()[0];
}

/** Items 'live' — los que el resolver tiene que evaluar. */
export function getLiveWatchlistItems(): WatchlistItemRow[] {
  return db.select().from(schema.watchlistItems)
    .where(eq(schema.watchlistItems.status, 'live'))
    .orderBy(asc(schema.watchlistItems.symbol))
    .all();
}

/** Items visibles en el watchlist (todo menos archivados). */
export function getActiveWatchlistItems(): WatchlistItemRow[] {
  return db.select().from(schema.watchlistItems)
    .where(sql`${schema.watchlistItems.status} != 'archived'`)
    .orderBy(desc(schema.watchlistItems.addedAt))
    .all();
}

/** Persiste una evaluación del resolver (precio/retorno + estado + resolución). */
export function updateWatchlistItemEvaluation(id: number, data: {
  status: string;
  lastPrice: number;
  lastReturn: number;
  lastEvaluatedAt: string;
  resolvedAt?: string | null;
  resolutionPrice?: number | null;
  resolutionReturn?: number | null;
}) {
  return db.update(schema.watchlistItems)
    .set(data)
    .where(eq(schema.watchlistItems.id, id))
    .run();
}

/** Archiva (saca de la lista activa) el/los item(s) no archivados de un símbolo. */
export function archiveWatchlistItemBySymbol(symbol: string) {
  return db.update(schema.watchlistItems)
    .set({ status: 'archived' })
    .where(and(
      eq(schema.watchlistItems.symbol, symbol),
      sql`${schema.watchlistItems.status} != 'archived'`,
    ))
    .run();
}

// ==================== CYCLE RADAR ====================

export interface CycleRadarSnapshotInsert {
  snapshotDate: string;
  symbol: string;
  label: string;
  categoria: 'pais' | 'sector';
  close: number;
  sma200: number | null;
  distSma200Pct: number | null;
  ret3m: number | null;
  ret6m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  sesionesEnLado: number | null;
  ladoSma: 'arriba' | 'abajo' | null;
  sharesOutstanding: number | null;
  flowDelta20d: number | null;
  cycleState: 'girando' | 'odiado' | 'tendencia' | 'extendido' | 'neutro' | null;
  stateReason: string | null;
}

/**
 * Reemplaza (delete+insert transaccional) los snapshots del día pero SOLO para los símbolos
 * presentes en `rows`. Si una canasta falló su fetch en esta corrida, su snapshot previo del
 * día (de una corrida anterior exitosa) NO se toca — un delete por fecha completa lo borraría
 * y lo dejaría invisible aunque hubiera datos válidos de antes.
 */
export function replaceCycleRadarSnapshotsForDate(date: string, rows: CycleRadarSnapshotInsert[]) {
  if (rows.length === 0) return;
  const symbols = rows.map(r => r.symbol);
  db.transaction((trx) => {
    trx.delete(schema.cycleRadarSnapshots)
      .where(and(eq(schema.cycleRadarSnapshots.snapshotDate, date), inArray(schema.cycleRadarSnapshots.symbol, symbols)))
      .run();
    trx.insert(schema.cycleRadarSnapshots).values(rows).run();
  });
}

export function getLatestCycleRadarDate(): string | null {
  const row = db.select({ d: schema.cycleRadarSnapshots.snapshotDate }).from(schema.cycleRadarSnapshots)
    .orderBy(desc(schema.cycleRadarSnapshots.snapshotDate)).limit(1).get();
  return row?.d ?? null;
}

export function getCycleRadarSnapshots(date: string) {
  return db.select().from(schema.cycleRadarSnapshots)
    .where(eq(schema.cycleRadarSnapshots.snapshotDate, date))
    .all();
}

// Pura (sin I/O): filas ordenadas por fecha asc -> serie de sharesOutstanding.
export function buildRadarSharesHistory(rows: Array<{ snapshotDate: string; sharesOutstanding: number | null }>): Array<number | null> {
  return rows.map(r => r.sharesOutstanding);
}

/**
 * excludeDate saca el snapshot de esa fecha de la historia. Necesario porque en re-corridas
 * del mismo día el radar ya insertó un snapshot de HOY antes de recalcular flowDelta20d: sin
 * excluirlo, ese snapshot viejo entra en la ventana y el share count nuevo se concatena
 * duplicado, corriendo el delta un día (off-by-one silencioso).
 */
export function getRadarSharesHistory(symbol: string, limit: number, excludeDate?: string): Array<number | null> {
  const rows = db.select({
    snapshotDate: schema.cycleRadarSnapshots.snapshotDate,
    sharesOutstanding: schema.cycleRadarSnapshots.sharesOutstanding,
  }).from(schema.cycleRadarSnapshots)
    .where(and(
      eq(schema.cycleRadarSnapshots.symbol, symbol),
      excludeDate ? ne(schema.cycleRadarSnapshots.snapshotDate, excludeDate) : undefined,
    ))
    .orderBy(desc(schema.cycleRadarSnapshots.snapshotDate)).limit(limit).all();
  return buildRadarSharesHistory(rows.reverse());
}

export function countCycleRadarDates(): number {
  const rows = db.selectDistinct({ d: schema.cycleRadarSnapshots.snapshotDate }).from(schema.cycleRadarSnapshots).all();
  return rows.length;
}

// --- Today proposals (registro de lo que "Hoy" propuso cada día) ---

export interface TodayProposalInsert {
  scanId: number;
  scanDate: string; // YYYY-MM-DD
  symbol: string;
  verb: string;         // COMPRAR | OBSERVAR (lo mostrado, post-degradación)
  engineAction: string; // BUY | WATCH
  score: number;
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  nthAppearance: number;
}

/**
 * Upsert por (scanDate, symbol): si hay varios scans en el día, gana el último — igual que la vista.
 * Ojo: no borra símbolos que cayeron del top entre scans del día — la tabla guarda la unión de lo
 * mostrado; todo lo registrado FUE propuesto en algún momento del día.
 */
export function upsertTodayProposals(rows: TodayProposalInsert[]): void {
  for (const row of rows) {
    db.insert(schema.todayProposals)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.todayProposals.scanDate, schema.todayProposals.symbol],
        // set omite createdAt a propósito: es el timestamp de la primera vez que se registró
        // el símbolo ese día, no se bumpea en updates posteriores.
        set: {
          scanId: row.scanId,
          verb: row.verb,
          engineAction: row.engineAction,
          score: row.score,
          entryPrice: row.entryPrice,
          stopLoss: row.stopLoss,
          targetPrice: row.targetPrice,
          nthAppearance: row.nthAppearance,
        },
      })
      .run();
  }
}

/**
 * Días distintos ANTERIORES a `beforeDate` en que cada símbolo ya apareció en el top de Hoy.
 * Excluye el día actual a propósito: la enésima aparición de hoy = resultado + 1, y así
 * el número no cambia si el scan se re-corre en el día (idempotente).
 */
export function getTodayProposalAppearances(symbols: string[], beforeDate: string): Map<string, number> {
  const map = new Map<string, number>();
  if (symbols.length === 0) return map;
  const rows = db
    .select({
      symbol: schema.todayProposals.symbol,
      days: sql<number>`count(distinct ${schema.todayProposals.scanDate})`,
    })
    .from(schema.todayProposals)
    .where(and(
      inArray(schema.todayProposals.symbol, symbols),
      lt(schema.todayProposals.scanDate, beforeDate),
    ))
    .groupBy(schema.todayProposals.symbol)
    .all();
  for (const r of rows) map.set(r.symbol, r.days);
  return map;
}

/**
 * Stop más alto fijado por señales recientes (`sinceDate` ≤ signal_date < `beforeDate`)
 * por símbolo. Alimenta la regla de stop perforado: si el precio actual está por DEBAJO
 * de un stop que el propio sistema fijó hace días, comprar es doble discurso (y midió
 * 32% win / −0.15R). `beforeDate` excluye las señales del scan de hoy — el stop nuevo
 * de hoy no puede vetarse a sí mismo. NO usa hit_stop/resolved_at a propósito: ambas
 * llegan semanas tarde (el resolver corre por cron); el precio vs stop es observable YA.
 */
export function getRecentStopLevels(symbols: string[], sinceDate: string, beforeDate: string): Map<string, number> {
  const map = new Map<string, number>();
  if (symbols.length === 0) return map;
  const rows = db
    .select({
      symbol: signalTracking.symbol,
      maxStop: sql<number>`max(${signalTracking.stopLoss})`,
    })
    .from(signalTracking)
    .where(and(
      inArray(signalTracking.symbol, symbols),
      sql`${signalTracking.stopLoss} IS NOT NULL`,
      gte(signalTracking.signalDate, sinceDate),
      lt(signalTracking.signalDate, beforeDate),
    ))
    .groupBy(signalTracking.symbol)
    .all();
  for (const r of rows) if (r.maxStop != null) map.set(r.symbol, r.maxStop);
  return map;
}

export interface TodayAccuracyBucket {
  bucket: string;       // '1' | '2-3' | '4+' | 'total'
  n: number;            // señales con outcome win/loss (neutral no cuenta para win rate)
  winRate: number;      // % redondeado a 1 decimal
  avgR: number | null;  // R-multiple promedio (incluye neutrales con R), null si no hay
}

/**
 * Track record de LO QUE HOY PROPUSO: join de today_proposals con signal_tracking por
 * (symbol, fecha). Solo outcomes resueltos; sin filas no se inventa nada (total null).
 */
export function getTodayProposalAccuracy(): { total: TodayAccuracyBucket | null; byBucket: TodayAccuracyBucket[] } {
  // Guard anti-SELL: si el símbolo flipeó a SELL en un scan posterior del mismo día, el tracking
  // de esa fila mide un short (win = precio cayó) — dirección invertida respecto a la card
  // COMPRAR/OBSERVAR que efectivamente se mostró. Hoy da 0 filas; guard preventivo.
  const rows = db.all<{ bucket: string; wins: number; losses: number; avg_r: number | null }>(sql`
    SELECT CASE WHEN tp.nth_appearance = 1 THEN '1'
                WHEN tp.nth_appearance <= 3 THEN '2-3'
                ELSE '4+' END AS bucket,
           SUM(st.outcome = 'win')  AS wins,
           SUM(st.outcome = 'loss') AS losses,
           AVG(st.r_multiple)       AS avg_r
    FROM today_proposals tp
    JOIN signal_tracking st ON st.symbol = tp.symbol AND st.signal_date = tp.scan_date
    WHERE st.outcome IN ('win', 'loss', 'neutral') AND st.action != 'SELL'
    GROUP BY bucket
  `);

  const toBucket = (bucket: string, wins: number, losses: number, avgR: number | null): TodayAccuracyBucket | null => {
    const n = wins + losses;
    if (n === 0) return null;
    return {
      bucket,
      n,
      winRate: Math.round((wins / n) * 1000) / 10,
      avgR: avgR == null ? null : Math.round(avgR * 1000) / 1000,
    };
  };

  const byBucket = rows
    .map((r) => toBucket(r.bucket, r.wins, r.losses, r.avg_r))
    .filter((b): b is TodayAccuracyBucket => b !== null);

  const totWins = rows.reduce((s, r) => s + r.wins, 0);
  const totLosses = rows.reduce((s, r) => s + r.losses, 0);
  // avg_r total ponderado no es exacto sumando promedios — se consulta aparte si hay filas.
  const totalAvgR = rows.length > 0
    ? db.all<{ avg_r: number | null }>(sql`
        SELECT AVG(st.r_multiple) AS avg_r
        FROM today_proposals tp
        JOIN signal_tracking st ON st.symbol = tp.symbol AND st.signal_date = tp.scan_date
        WHERE st.outcome IN ('win', 'loss', 'neutral') AND st.action != 'SELL'
      `)[0]?.avg_r ?? null
    : null;

  return { total: toBucket('total', totWins, totLosses, totalAvgR), byBucket };
}

// ==================== THESES (motor de tesis) ====================
// FRONTERA: estos getters/writers son el único punto de contacto de theses/ con el resto del
// sistema. theses/ LEE de opportunities/radar/macro a través de los getters de arriba (scans,
// snapshots, cycle radar, macro events) — pero ningún dominio de scan/radar/macro importa nada
// de acá ni de theses/. La dependencia es unidireccional: theses/ conoce el scan, el scan no
// conoce theses/.

export function insertThesis(data: {
  createdDate: string;
  title: string;
  direction: string;
  narrative: string;
  catalyst: string | null;
  primarySymbol: string;
  symbols: string; // JSON stringified
  entryConditionText: string;
  entryTriggerPrice: number;
  entryComparator: string;
  invalidationPrice: number;
  invalidationReason: string;
  horizonDays: number;
  sourceEvidence: string;
  llmProvider: string;
}): void {
  db.insert(schema.theses).values(data).run();
}

/** Tesis creadas en una fecha dada — usado para la idempotencia del generador semanal. */
export function getThesesByCreatedDate(date: string) {
  return db.select().from(schema.theses)
    .where(eq(schema.theses.createdDate, date))
    .all();
}

/** Tesis todavía "vivas" (no llegaron a un estado terminal) — insumo del evaluador diario. */
export function getActiveTheses() {
  return db.select().from(schema.theses)
    .where(inArray(schema.theses.status, ['activa', 'gatillada']))
    .all();
}

/** Todas las tesis, más nueva primero — insumo del tab "Tesis" (lista completa, no solo vivas). */
export function getAllTheses() {
  return db.select().from(schema.theses)
    .orderBy(desc(schema.theses.createdAt))
    .all();
}

export function updateThesis(id: number, data: Partial<{
  status: string;
  triggeredAt: string | null;
  resolvedAt: string | null;
  outcomeReturnPct: number | null;
  outcomeVsSpyPct: number | null;
}>): void {
  db.update(schema.theses).set(data).where(eq(schema.theses.id, id)).run();
}

/** Eventos macro desde `sinceDate` (inclusive) hasta hoy — insumo del generador semanal. */
export function getRecentMacroEvents(sinceDate: string) {
  return db.select().from(schema.macroEvents)
    .where(gte(schema.macroEvents.date, sinceDate))
    .orderBy(desc(schema.macroEvents.date))
    .all();
}
