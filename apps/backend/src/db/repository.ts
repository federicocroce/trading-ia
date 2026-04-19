import { eq, desc, gte, asc, and, inArray, gt, sql } from 'drizzle-orm';
import { db, schema } from './index.js';
import { missedOpportunities, signalTracking } from './schema.js';

// ==================== SYMBOLS ====================

export function getAllSymbols() {
  return db.select().from(schema.symbols).where(eq(schema.symbols.active, true)).all();
}

export function getSymbol(symbol: string) {
  return db.select().from(schema.symbols).where(eq(schema.symbols.symbol, symbol)).get();
}

type SymbolPlaza = 'argentina-energy' | 'argentina-finance' | 'argentina-cedears' | 'us-energy' | 'us-tech' | 'crypto' | 'bonds' | 'etfs-sectors' | 'commodities' | 'emerging-markets' | 'global';

export function insertSymbol(data: {
  symbol: string;
  name: string;
  type: 'adr' | 'us' | 'crypto';
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
    })
    .where(eq(schema.newsArticles.externalId, externalId))
    .run();
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

// ==================== DISCOVERED SYMBOLS ====================

export function upsertDiscoveredSymbol(data: {
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
}) {
  const existing = db.select().from(schema.discoveredSymbols)
    .where(eq(schema.discoveredSymbols.symbol, data.symbol))
    .get();

  if (existing) {
    return db.update(schema.discoveredSymbols)
      .set({
        lastSeen: new Date().toISOString(),
        newsCount: (existing.newsCount ?? 0) + 1,
        relevanceScore: Math.min(100, (existing.relevanceScore ?? 0) + 10),
        expiresAt: data.expiresAt,
        active: true,
      })
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

export function deactivateExpiredDiscoveries() {
  const now = new Date().toISOString();
  const all = db.select().from(schema.discoveredSymbols)
    .where(eq(schema.discoveredSymbols.active, true))
    .all();

  let deactivated = 0;
  for (const s of all) {
    if (s.expiresAt <= now) {
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

  return {
    total,
    wins,
    losses,
    neutrals,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    avgReturn7d: Math.round(avgReturn7d * 100) / 100,
    avgReturn30d: Math.round(avgReturn30d * 100) / 100,
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
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.sector} IS NOT NULL`)
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
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending'`)
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
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending'`)
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
  .where(sql`${signalTracking.outcome} IS NOT NULL AND ${signalTracking.outcome} != 'pending' AND ${signalTracking.techScore} IS NOT NULL`)
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
    }));
}

export function getLatestSectorImpacts() {
  const today = new Date().toISOString().split('T')[0];
  return getSectorImpactsByDate(today);
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
