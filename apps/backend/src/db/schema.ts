import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Symbols / Watchlist ---
export const symbols = sqliteTable('symbols', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['adr', 'us', 'crypto'] }).notNull(),
  flag: text('flag').notNull().default('🌐'),
  plaza: text('plaza', {
    enum: ['argentina-energy', 'argentina-finance', 'argentina-cedears', 'us-energy', 'us-tech', 'crypto', 'bonds', 'global'],
  }).notNull().default('global'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Portfolio positions (current holdings) ---
export const positions = sqliteTable('positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().references(() => symbols.symbol),
  quantity: real('quantity').notNull(),
  avgCost: real('avg_cost').notNull(),
  notes: text('notes'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Opportunity scans (one row per scan run) ---
export const opportunityScans = sqliteTable('opportunity_scans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scannedAt: text('scanned_at').notNull(), // ISO datetime
  engine: text('engine').notNull(), // groq, openrouter, claude, algorithmic
  engineDetail: text('engine_detail').notNull(),
  totalSymbolsScanned: integer('total_symbols_scanned').notNull(),
  opportunityCount: integer('opportunity_count').notNull(),
  opportunities: text('opportunities').notNull(), // JSON stringified array
  sectorSummary: text('sector_summary').notNull(), // JSON stringified array
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Opportunity snapshots (one row per symbol per scan — fast queries) ---
export const opportunitySnapshots = sqliteTable('opportunity_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').notNull().references(() => opportunityScans.id),
  symbol: text('symbol').notNull(),
  sector: text('sector').notNull(),
  opportunityScore: integer('opportunity_score').notNull(),
  recommendation: text('recommendation').notNull(), // COMPRAR, OBSERVAR, NO COMPRAR
  currentPrice: real('current_price').notNull(),
  shortTermMid: real('short_term_mid').notNull(), // % estimado base corto plazo
  mediumTermMid: real('medium_term_mid').notNull(), // % estimado base mediano plazo
  confidence: integer('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  data: text('data').notNull(), // Full opportunity object as JSON
  scannedAt: text('scanned_at').notNull(), // Denormalized for easy date queries
});

// --- News articles (persistent news storage) ---
export const newsArticles = sqliteTable('news_articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull(),
  source: text('source').notNull(),              // "Yahoo Finance", "Finnhub", "RSS:Reuters"
  sourceType: text('source_type').notNull(),     // "api", "rss", "scraper"
  title: text('title').notNull(),
  summary: text('summary'),
  url: text('url'),
  publishedAt: text('published_at').notNull(),
  relatedSymbols: text('related_symbols').notNull(), // JSON array
  sentiment: text('sentiment'),                  // after LLM analysis
  impact: text('impact'),
  storyClusterId: text('story_cluster_id'),      // triangulation
  triangulationConfidence: text('triangulation_confidence'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Transactions (buy/sell history) ---
export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().references(() => symbols.symbol),
  type: text('type', { enum: ['BUY', 'SELL', 'DIVIDEND'] }).notNull(),
  quantity: real('quantity').notNull(),
  price: real('price').notNull(),
  fees: real('fees').notNull().default(0),
  date: text('date').notNull(), // ISO date string
  currency: text('currency').notNull().default('USD'), // USD, USDC, ARS
  totalAmount: real('total_amount'), // monto total debitado (override de qty × price)
  platform: text('platform'), // e.g. "Balanz", "Buenbit", "IOL"
  externalId: text('external_id'), // nro de operación externo (evita duplicados)
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
