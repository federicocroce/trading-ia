import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Symbols / Watchlist ---
export const symbols = sqliteTable('symbols', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['adr', 'us', 'crypto', 'bond', 'etf', 'commodity'] }).notNull(),
  flag: text('flag').notNull().default('🌐'),
  plaza: text('plaza', {
    enum: ['argentina-energy', 'argentina-finance', 'argentina-cedears', 'us-energy', 'us-tech', 'crypto', 'bonds', 'etfs-sectors', 'commodities', 'emerging-markets', 'global'],
  }).notNull().default('global'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- ETF Watchlist (separate from portfolio symbols) ---
export const etfWatchlist = sqliteTable('etf_watchlist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  category: text('category', {
    enum: ['indices', 'sectores', 'bonos', 'commodities', 'latam', 'internacional', 'crypto', 'factor'],
  }).notNull(),
  description: text('description'),
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
  status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull().default('ok'),
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
  body: text('body'),                            // full article body extracted via Readability (cached)
  bodyFetchedAt: text('body_fetched_at'),        // when body was extracted (for staleness checks)
  url: text('url'),
  publishedAt: text('published_at').notNull(),
  relatedSymbols: text('related_symbols').notNull(), // JSON array
  sentiment: text('sentiment'),                  // after LLM analysis
  impact: text('impact'),
  storyClusterId: text('story_cluster_id'),      // triangulation
  triangulationConfidence: text('triangulation_confidence'),
  analyzedAt: text('analyzed_at'),               // seteado al persistir análisis LLM/fallback — evita re-analizar neutrales en cada run
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Daily intelligence reports ---
export const dailyReports = sqliteTable('daily_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reportDate: text('report_date').notNull(),
  reportType: text('report_type').notNull(),       // 'morning' | 'on-demand'
  scanId: integer('scan_id').references(() => opportunityScans.id),
  newsSourceStats: text('news_source_stats').notNull(),      // JSON
  totalNewsCount: integer('total_news_count').notNull(),
  triangulationStats: text('triangulation_stats').notNull(),  // JSON
  secondOrderEffects: text('second_order_effects').notNull(), // JSON
  antiHypeResults: text('anti_hype_results').notNull(),       // JSON
  topRecommendations: text('top_recommendations').notNull(),  // JSON
  sectorSummary: text('sector_summary').notNull(),            // JSON
  totalSymbolsScanned: integer('total_symbols_scanned').notNull(),
  analysisEngine: text('analysis_engine').notNull(),
  analysisDetail: text('analysis_detail').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Second-order sector effects log (NOTA: tabla sin uso, los effects se calculan in-memory) ---
export const sectorEffects = sqliteTable('sector_effects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').references(() => opportunityScans.id),
  triggerEvent: text('trigger_event').notNull(),
  causalChain: text('causal_chain').notNull(),       // JSON array of strings
  affectedTickers: text('affected_tickers').notNull(), // JSON array
  impactDirection: text('impact_direction').notNull(),
  confidence: text('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Swing alerts (mean-reversion / volatile plays) ---
export const swingAlerts = sqliteTable('swing_alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  alertType: text('alert_type').notNull(),           // 'drop-1d' | 'surge-1d' | 'drop-2d'
  direction: text('direction').notNull(),             // 'BUY' | 'SELL'
  triggerDescription: text('trigger_description').notNull(),
  triggerPercent: real('trigger_percent').notNull(),
  triggerPrice: real('trigger_price').notNull(),
  entryPrice: real('entry_price').notNull(),
  targetPrice: real('target_price'),
  stopLoss: real('stop_loss'),
  historicalWinRate: real('historical_win_rate').notNull(),
  historicalAvgReturn: real('historical_avg_return').notNull(),
  historicalSampleSize: integer('historical_sample_size').notNull(),
  status: text('status').notNull().default('active'), // active | resolved-win | resolved-loss | expired
  nextDayClose: real('next_day_close'),
  nextDayChange: real('next_day_change'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
});

// --- Anticipatory alerts (confluencia bullish >=2 señales + stop breaches) ---
export const anticipatoryAlerts = sqliteTable('anticipatory_alerts', {
  id: text('id').primaryKey(),                        // `${symbol}:${cats}` | `stop:${symbol}`
  kind: text('kind').notNull().default('anticipatory'), // 'anticipatory' | 'stop_breach' | 'rearm'
  symbol: text('symbol').notNull(),
  signals: text('signals').notNull(),                  // JSON BullishSignal[]
  currentPrice: real('current_price').notNull(),
  entryPrice: real('entry_price'),
  stopLoss: real('stop_loss'),
  takeProfit: real('take_profit'),
  score: real('score').notNull().default(0),
  status: text('status').notNull().default('active'),  // active | triggered | expired
  firstSeenDate: text('first_seen_date').notNull(),    // YYYY-MM-DD
  lastSeenDate: text('last_seen_date').notNull(),
  seen: integer('seen', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  // Outcome resolution (¿la movida anticipada ocurrió?) — NULL = sin resolver aún
  outcome: text('outcome'),                            // 'triggered' | 'missed' | 'expired'
  resolutionPrice: real('resolution_price'),
  resolutionReturn: real('resolution_return'),         // % vs entryPrice
  resolvedAt: text('resolved_at'),
});

// --- Discovered symbols (dynamic universe) ---
export const discoveredSymbols = sqliteTable('discovered_symbols', {
  symbol: text('symbol').primaryKey(),
  name: text('name').notNull(),
  instrumentType: text('instrument_type').notNull(),
  sector: text('sector').notNull(),
  industry: text('industry'),
  market: text('market').notNull(),
  exchange: text('exchange'),
  discoveredFrom: text('discovered_from').notNull(),
  relevanceScore: integer('relevance_score').notNull().default(0),
  newsCount: integer('news_count').notNull().default(1),
  firstSeen: text('first_seen').notNull().default(sql`(datetime('now'))`),
  lastSeen: text('last_seen').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// --- Signal tracking (accuracy measurement) ---
export const signalTracking = sqliteTable('signal_tracking', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  signalDate: text('signal_date').notNull(),          // fecha en que se emitio la senal
  action: text('action').notNull(),                    // BUY | SELL | HOLD | WATCH
  entryPrice: real('entry_price').notNull(),           // precio al momento de la senal
  targetPrice: real('target_price'),
  stopLoss: real('stop_loss'),
  confidence: integer('confidence').notNull(),
  opportunityScore: integer('opportunity_score').notNull(),
  // Dimension scores para analisis de accuracy por componente
  sector: text('sector'),
  techScore: integer('tech_score'),
  fundScore: integer('fund_score'),
  sentScore: real('sent_score'),
  hadDivergences: integer('had_divergences', { mode: 'boolean' }),
  enrichedByLlm: integer('enriched_by_llm', { mode: 'boolean' }),
  shortTermScore: integer('short_term_score'),
  mediumTermScore: integer('medium_term_score'),
  rsiAtSignal: real('rsi_at_signal'),
  predictedReturnMid: real('predicted_return_mid'),
  // Resultado (se llena despues)
  priceAfter7d: real('price_after_7d'),
  priceAfter30d: real('price_after_30d'),
  returnAfter7d: real('return_after_7d'),              // % de cambio a 7 dias
  returnAfter30d: real('return_after_30d'),             // % de cambio a 30 dias
  hitTarget: integer('hit_target', { mode: 'boolean' }),
  hitStop: integer('hit_stop', { mode: 'boolean' }),
  outcome: text('outcome'),                            // 'win' | 'loss' | 'neutral' | 'pending'
  resolvedAt: text('resolved_at'),
  // Portfolio context
  isPortfolioHold: integer('is_portfolio_hold', { mode: 'boolean' }).default(false),
  // Setup quality (P1 clamp de riesgo): true si el setup fue invalidado por riesgo del stop
  // > MAX_SETUP_RISK_PCT — incluye BUY degradados a WATCH (ver signal-tracking.service.ts).
  // Permite medir después si el filtro salvó plata o costó upside.
  setupInvalid: integer('setup_invalid', { mode: 'boolean' }),
  // Entry accuracy
  entryHit: integer('entry_hit', { mode: 'boolean' }),
  entryDeviation: real('entry_deviation'),
  entryHitAt: text('entry_hit_at'),
  // Target accuracy (hitTarget already exists — only add deviation/date)
  targetDeviation: real('target_deviation'),
  targetHitAt: text('target_hit_at'),
  // Stop accuracy (hitStop already exists — only add deviation/date)
  stopDeviation: real('stop_deviation'),
  stopTriggeredAt: text('stop_triggered_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  // Evidence V2 signal components (for future accuracy analysis by component)
  peadScore: integer('pead_score'),
  insiderScore: integer('insider_score'),
  optionsScore: integer('options_score'),
  activeSignalsCount: integer('active_signals_count'),
  marketRegimeAtSignal: text('market_regime_at_signal'),
  fundamentalsMultiplier: real('fundamentals_multiplier'),
  beatPercent: real('beat_percent'),
  consecutiveBeats: integer('consecutive_beats'),
  aiVerdict: text('ai_verdict'),
  aiConfidence: integer('ai_confidence'),
  // A/B tracking: algo vs LLM divergence (qué acertó cuando difirieron)
  algoAction: text('algo_action'),                      // acción que diría el composite puro
  llmAction: text('llm_action'),                        // acción que dio el LLM Stage 5b
  verdictSource: text('verdict_source'),                // 'algo' | 'smart' | 'llm'
  whoWasRight: text('who_was_right'),                   // 'algo' | 'llm' | 'both' | 'neither' | 'pending' — resuelto post-outcome
  evidenceScore: integer('evidence_score'),             // 4to eje del composite
  macroDelta: integer('macro_delta'),                   // ajuste macro aplicado (-15..+15)
  // R-múltiplo: retorno medido en unidades de riesgo (entry→stop). Expectancy real del sistema.
  rMultiple: real('r_multiple'),
});

// --- Registro de propuestas de "Hoy" ---
// Qué mostró la vista cada día (top-6 de "Oportunidades - no las tenés"), para poder medir
// el accuracy de LO PROPUESTO (no del scan entero) y contar apariciones (residente crónico).
// Se llena al persistir cada scan con la misma selección pura que usa la vista — fuente única.
export const todayProposals = sqliteTable('today_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').notNull(),
  scanDate: text('scan_date').notNull(),               // YYYY-MM-DD del scan
  symbol: text('symbol').notNull(),
  verb: text('verb').notNull(),                        // COMPRAR | OBSERVAR — lo que se mostró (post-degradación crónica)
  engineAction: text('engine_action').notNull(),       // BUY | WATCH — acción cruda del motor
  score: integer('score').notNull(),
  entryPrice: real('entry_price'),
  stopLoss: real('stop_loss'),
  targetPrice: real('target_price'),
  nthAppearance: integer('nth_appearance').notNull(),  // 1 = primera vez en el top de Hoy (días distintos)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('today_proposals_date_symbol_uq').on(t.scanDate, t.symbol)]);

// --- Historical price cache (1 day TTL daily, 1 week TTL weekly) ---
export const historicalCache = sqliteTable('historical_cache', {
  id: text('id').primaryKey(),              // "VIST:daily" or "VIST:weekly"
  symbol: text('symbol').notNull(),
  interval: text('interval').notNull(),     // 'daily' | 'weekly'
  data: text('data').notNull(),             // JSON array of OHLC
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

// --- Fundamental cache (7 day TTL per symbol) ---
export const fundamentalCache = sqliteTable('fundamental_cache', {
  symbol: text('symbol').primaryKey(),
  data: text('data').notNull(),                 // JSON with all FundamentalData fields
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),      // fetched_at + 7 days
});

// --- Sector impacts (from news analysis, 1 day TTL) ---
export const sectorImpacts = sqliteTable('sector_impacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reportDate: text('report_date').notNull(),
  sector: text('sector').notNull(),
  impact: text('impact').notNull(),              // 'positive' | 'negative' | 'mixed'
  event: text('event').notNull(),
  summary: text('summary').notNull(),
  keyNews: text('key_news').notNull(),           // JSON array
  suggestedTickers: text('suggested_tickers').notNull(), // JSON array
  riskFactors: text('risk_factors').notNull(),   // JSON array
  catalysts: text('catalysts').notNull().default('[]'),   // JSON array — new
  conviccion: text('conviccion').notNull().default('media'), // 'alta' | 'media' | 'baja' — new
  tension: text('tension'),                      // nullable string — new
  confidence: text('confidence').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Missed opportunities (WATCH/HOLD that surged) ---
export const missedOpportunities = sqliteTable('missed_opportunities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  scanDate: text('scan_date').notNull(),
  actionGiven: text('action_given').notNull(),        // WATCH or HOLD
  opportunityScore: integer('opportunity_score'),
  actualReturn7d: real('actual_return_7d'),
  actualReturn30d: real('actual_return_30d'),
  wouldHaveBeen: text('would_have_been'),             // BUY if return > 5%, STRONG_BUY if > 10%
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Watchlist lifecycle (le da lado de cierre al watchlist `symbols`) ---
export const watchlistItems = sqliteTable('watchlist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  addedAt: text('added_at').notNull(),                  // ISO date del alta
  source: text('source').notNull().default('manual'),   // 'recommendation' | 'manual'
  // Snapshot al agregar
  entryPrice: real('entry_price').notNull(),
  entryAction: text('entry_action').notNull().default('manual'), // BUY | SELL | WATCH | HOLD | manual
  entryScore: integer('entry_score'),
  entryConfidence: integer('entry_confidence'),
  targetPrice: real('target_price'),                    // de tradeLevels.takeProfit (nullable)
  stopLoss: real('stop_loss'),                          // de tradeLevels.stopLoss (nullable)
  thesis: text('thesis'),
  horizonDays: integer('horizon_days').notNull().default(30),
  // Estado del ciclo de vida
  status: text('status').notNull().default('live'),     // live | triggered | invalidated | expired | archived
  lastPrice: real('last_price'),
  lastReturn: real('last_return'),
  lastEvaluatedAt: text('last_evaluated_at'),
  resolvedAt: text('resolved_at'),
  resolutionPrice: real('resolution_price'),
  resolutionReturn: real('resolution_return'),
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

// --- Market digest (wouldDo / wouldNotDo / summary — persisted per day) ---
export const marketDigests = sqliteTable('market_digests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reportDate: text('report_date').notNull().unique(), // YYYY-MM-DD
  digest: text('digest').notNull(),                   // JSON (MarketDigest)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Market themes (reemplaza THEMATIC_QUERIES hardcodeadas) ---
export const marketThemes = sqliteTable('market_themes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  queryKeywords: text('query_keywords').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- News sources configurables (reemplaza RSS_FEEDS hardcodeadas) ---
export const newsSources = sqliteTable('news_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['rss', 'newsapi', 'finnhub'] }).notNull(),
  url: text('url'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Keywords para búsqueda en NewsAPI ---
export const newsSearchKeywords = sqliteTable('news_search_keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull(),
  category: text('category'),
  priority: integer('priority').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// --- Keywords para análisis de sentimiento ---
export const sentimentKeywords = sqliteTable('sentiment_keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull(),
  language: text('language', { enum: ['en', 'es'] }).notNull().default('en'),
  sentiment: text('sentiment', { enum: ['positive', 'negative'] }).notNull(),
  impactLevel: text('impact_level', { enum: ['high', 'medium'] }),
  weight: real('weight').notNull().default(1.0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// --- Tickers sugeridos por sector ---
export const sectorTickers = sqliteTable('sector_tickers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sector: text('sector').notNull(),
  ticker: text('ticker').notNull(),
  weight: real('weight').notNull().default(1.0),
  relevance: text('relevance', { enum: ['primary', 'secondary'] }).notNull().default('primary'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Reportes de mercado generados (persistencia) ---
export const marketReports = sqliteTable('market_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedAt: text('generated_at').notNull(),
  status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull(),
  macroContext: text('macro_context'),
  portfolioImpact: text('portfolio_impact'),
  topImpactNews: text('top_impact_news'),
  themes: text('themes'),
  topRecommendations: text('top_recommendations'),
  alternatives: text('alternatives'),
  scenarios: text('scenarios'),
  avoidList: text('avoid_list'),
  engine: text('engine'),
  errors: text('errors'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Quota exhaustion tracking (skip exhausted models until reset) ---
export const quotaExhausted = sqliteTable('quota_exhausted', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),   // 'gemini' | 'groq' | 'openrouter'
  model: text('model').notNull(),
  keyIndex: integer('key_index'),         // null for groq/openrouter (no key rotation)
  exhaustedAt: text('exhausted_at').notNull().default(sql`(datetime('now'))`),
  resetAt: text('reset_at').notNull(),    // ISO timestamp when quota resets
});

// --- Web search results ---
export const webSearchArticles = sqliteTable('web_search_articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  symbol: text('symbol'),
  query: text('query').notNull(),
  layer: text('layer', { enum: ['portfolio', 'discovery'] }).notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  content: text('content').notNull(),
  publishedAt: text('published_at'),
  relatedSymbols: text('related_symbols').notNull().default('[]'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Historial de ejecuciones del pipeline ---
export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  status: text('status', { enum: ['running', 'ok', 'partial', 'failed', 'waiting_user', 'cancelled'] }).notNull(),
  // Stage: webSearch (new — first stage)
  webSearchStatus: text('web_search_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped', 'waiting_user'] }).notNull().default('pending'),
  webSearchDetail: text('web_search_detail'),
  webSearchErrors: text('web_search_errors'),
  webSearchStartedAt: text('web_search_started_at'),
  webSearchFinishedAt: text('web_search_finished_at'),
  // Stage: news
  newsStatus: text('news_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  newsDetail: text('news_detail'),
  newsErrors: text('news_errors'),
  newsStartedAt: text('news_started_at'),
  newsFinishedAt: text('news_finished_at'),
  // Stage: macroIntelligence
  macroIntelligenceStatus: text('macro_intelligence_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  macroIntelligenceDetail: text('macro_intelligence_detail'),
  macroIntelligenceErrors: text('macro_intelligence_errors'),
  macroIntelligenceStartedAt: text('macro_intelligence_started_at'),
  macroIntelligenceFinishedAt: text('macro_intelligence_finished_at'),
  // Stage: sectorIntelligence (runs after macroIntelligence, before fundamentals)
  sectorIntelligenceStatus: text('sector_intelligence_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  sectorIntelligenceDetail: text('sector_intelligence_detail'),
  sectorIntelligenceErrors: text('sector_intelligence_errors'),
  sectorIntelligenceStartedAt: text('sector_intelligence_started_at'),
  sectorIntelligenceFinishedAt: text('sector_intelligence_finished_at'),
  // Stage: fundamentals
  fundamentalsStatus: text('fundamentals_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  fundamentalsDetail: text('fundamentals_detail'),
  fundamentalsErrors: text('fundamentals_errors'),
  fundamentalsStartedAt: text('fundamentals_started_at'),
  fundamentalsFinishedAt: text('fundamentals_finished_at'),
  // Stage: analysis
  analysisStatus: text('analysis_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  analysisDetail: text('analysis_detail'),
  analysisErrors: text('analysis_errors'),
  analysisStartedAt: text('analysis_started_at'),
  analysisFinishedAt: text('analysis_finished_at'),
  // Stage: quant (non-blocking, runs after analysis)
  quantStatus: text('quant_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  quantDetail: text('quant_detail'),
  quantErrors: text('quant_errors'),
  quantStartedAt: text('quant_started_at'),
  quantFinishedAt: text('quant_finished_at'),
  // Stage: report
  reportStatus: text('report_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  reportDetail: text('report_detail'),
  reportErrors: text('report_errors'),
  reportStartedAt: text('report_started_at'),
  reportFinishedAt: text('report_finished_at'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Backtest runs ---
export const backtestRuns = sqliteTable('backtest_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  strategy: text('strategy').notNull(),
  metrics: text('metrics'),
  trades: text('trades'),
  equityCurve: text('equity_curve'),
  status: text('status').notNull().default('running'),
  error: text('error'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Calibrated weights history ---
export const calibratedWeightsTable = sqliteTable('calibrated_weights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  weights: text('weights').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Discovery Queries (user-configurable web search queries) ---
export const discoveryQueries = sqliteTable('discovery_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  query: text('query').notNull(),
  lang: text('lang', { enum: ['en', 'es'] }).notNull().default('en'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  category: text('category').notNull().default('general'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Thematic Queries (user-configurable market report themes) ---
export const thematicQueries = sqliteTable('thematic_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  keywords: text('keywords').notNull(), // JSON array of strings
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Pipeline Stage Artifacts (audit trail per stage per run) ---
export const pipelineStageArtifacts = sqliteTable('pipeline_stage_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').notNull().references(() => pipelineRuns.id),
  stage: text('stage', { enum: ['webSearch', 'news', 'fundamentals', 'analysis', 'report', 'digest'] }).notNull(),
  inputSnapshot: text('input_snapshot'),   // JSON — truncated to 50KB max
  outputSnapshot: text('output_snapshot'), // JSON — truncated to 50KB max
  tokensUsed: integer('tokens_used'),
  modelUsed: text('model_used'),
  symbolsProcessed: text('symbols_processed'), // JSON array of strings
  durationMs: integer('duration_ms'),
  errorCount: integer('error_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Unified Analysis Batches (each LLM call during unified analysis) ---
export const unifiedAnalysisBatches = sqliteTable('unified_analysis_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').notNull().references(() => pipelineRuns.id),
  batchIndex: integer('batch_index').notNull(),
  assetsInput: text('assets_input').notNull(),  // JSON array of symbol names
  modelUsed: text('model_used').notNull(),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  durationMs: integer('duration_ms'),
  parsedOk: integer('parsed_ok', { mode: 'boolean' }).notNull().default(true),
  errorMsg: text('error_msg'),
  rawResponse: text('raw_response'), // Full LLM response (always saved)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Unified Analysis per Symbol (parsed individual results) ---
export const unifiedAnalysisResults = sqliteTable('unified_analysis_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
  symbol: text('symbol').notNull(),
  generatedAt: text('generated_at').notNull().default(sql`(datetime('now'))`),
  action: text('action', { enum: ['BUY', 'SELL', 'HOLD', 'WATCH'] }).notNull(),
  inPortfolio: integer('in_portfolio', { mode: 'boolean' }).notNull().default(false),
  thesis: text('thesis').notNull(),
  catalysts: text('catalysts').notNull(),     // JSON string[]
  risks: text('risks').notNull(),              // JSON string[]
  wouldDo: text('would_do').notNull(),         // JSON string[]
  wouldNotDo: text('would_not_do').notNull(),  // JSON string[]
  narrative: text('narrative').notNull(),
  macroTheme: text('macro_theme'),
  generatedBy: text('generated_by').notNull(),
  opportunityScore: integer('opportunity_score'),
  // Synthetic dedupe key: pipelineRunId-symbol if run-scoped, YYYY-MM-DD-symbol if manual.
  // Enforces "one analysis per symbol per pipeline run, or per symbol per day if manual".
  dedupeKey: text('dedupe_key').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- News Radar Snapshots (v2 deep analysis output) ---
// One row per radar generation. Stores per-article cause+impacts + aggregated signals.
export const newsRadarSnapshots = sqliteTable('news_radar_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').references(() => pipelineRuns.id),
  generatedAt: text('generated_at').notNull().default(sql`(datetime('now'))`),
  totalNewsAnalyzed: integer('total_news_analyzed').notNull(),
  perArticle: text('per_article').notNull(),         // JSON: Array<{newsId, cause, positive[], negative[]}>
  aggregatedSignals: text('aggregated_signals').notNull(), // JSON: ranked targets with pos/neg counts
  emergingNarratives: text('emerging_narratives'),   // JSON: optional 1-3 strings
  llmModel: text('llm_model'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- News Intelligence Snapshots (plazas + symbolTrends frozen-in-time) ---
// One row per refreshIntelligence run. Lets us audit "what did the sentiment look
// like at 14:00 yesterday" without re-running aggregateTrends from raw articles.
export const newsIntelligenceSnapshots = sqliteTable('news_intelligence_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedAt: text('generated_at').notNull().default(sql`(datetime('now'))`),
  totalNewsCount: integer('total_news_count').notNull(),
  plazas: text('plazas').notNull(),        // JSON: PlazaSummary[]
  alerts: text('alerts').notNull(),         // JSON: IntelligenceAlert[]
  topHeadlines: text('top_headlines'),      // JSON: string[]
  triangulationStats: text('triangulation_stats'),  // JSON
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Anti-Hype Rejections (audit trail for filtered opportunities) ---
// Records every symbol that gets rejected by the anti-hype pre-scoring filter,
// with the specific reasons. Lets us answer "why didn't VIST appear in
// opportunities yesterday?" without re-running the scan.
export const antiHypeRejections = sqliteTable('anti_hype_rejections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').references(() => opportunityScans.id),
  symbol: text('symbol').notNull(),
  reasons: text('reasons').notNull(),       // JSON: string[]
  mode: text('mode'),                        // 'strict' | 'relaxed'
  rejectedAt: text('rejected_at').notNull().default(sql`(datetime('now'))`),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Scoring Weight Proposals (semi-automatic weight adjustment) ---
export const scoringWeightProposals = sqliteTable('scoring_weight_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  proposedAt: text('proposed_at').notNull().default(sql`(datetime('now'))`),
  signalCount: integer('signal_count').notNull(),
  shortTermBasis: integer('short_term_basis').notNull(),
  mediumTermBasis: integer('medium_term_basis').notNull(),
  currentWeights: text('current_weights').notNull(),
  proposedWeights: text('proposed_weights').notNull(),
  correlations: text('correlations').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  approvedAt: text('approved_at'),
  appliedAt: text('applied_at'),
  rejectedReason: text('rejected_reason'),
});

// --- Scoring Weight History (all applied weight changes) ---
export const scoringWeightHistory = sqliteTable('scoring_weight_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  appliedAt: text('applied_at').notNull().default(sql`(datetime('now'))`),
  weights: text('weights').notNull(),
  source: text('source', { enum: ['manual', 'proposal'] }).notNull(),
  proposalId: integer('proposal_id').references(() => scoringWeightProposals.id),
  accuracyBefore: real('accuracy_before'),
  accuracyAfter: real('accuracy_after'),
});

// --- Evidence signals cache (V2 system — 6h TTL per symbol) ---
export const evidenceSignalsCache = sqliteTable('evidence_signals_cache', {
  symbol: text('symbol').primaryKey(),
  data: text('data').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

// --- Evidence deep analysis (AI verdict per signal — 6h TTL) ---
export const evidenceDeepAnalysis = sqliteTable('evidence_deep_analysis', {
  symbol: text('symbol').primaryKey(),
  analysisDate: text('analysis_date').notNull(),
  verdict: text('verdict', { enum: ['BUY_SETUP', 'WAIT', 'PASS'] }).notNull(),
  reasoning: text('reasoning').notNull(),
  entryZone: text('entry_zone').notNull(),
  target: text('target').notNull(),
  stopLoss: text('stop_loss').notNull(),
  riskReward: text('risk_reward').notNull(),
  confidence: integer('confidence').notNull(),
  keyRisks: text('key_risks').notNull(),  // JSON array
  timeframe: text('timeframe').notNull(),
  model: text('model').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const evidenceScanRuns = sqliteTable('evidence_scan_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  totalSymbols: integer('total_symbols'),
  scannedOk: integer('scanned_ok'),
  failedCount: integer('failed_count'),
  highConviction: integer('high_conviction'),
  mediumConviction: integer('medium_conviction'),
  withSignals: integer('with_signals'),
  marketRegime: text('market_regime'),    // 'bull' | 'bear' | 'neutral'
  spyPrice: real('spy_price'),
  forceRefresh: integer('force_refresh', { mode: 'boolean' }),
  errorMessage: text('error_message'),    // set if scan crashed
  durationMs: integer('duration_ms'),
});

// --- Sector rotation cache (ETF performance & relative strength) ---
export const sectorRotationCache = sqliteTable('sector_rotation_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  etf: text('etf').notNull(),
  sectorName: text('sector_name').notNull(),
  return1m: real('return_1m').notNull(),
  return3m: real('return_3m').notNull(),
  relativeStrength1m: real('relative_strength_1m').notNull(),
  relativeStrength3m: real('relative_strength_3m').notNull(),
  category: text('category', { enum: ['LEADING', 'NEUTRAL', 'LAGGING'] }).notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Evidence signals snapshots (historical record per scan) ---
export const evidenceSignalsSnapshots = sqliteTable('evidence_signals_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanDate: text('scan_date').notNull(),       // YYYY-MM-DD
  scannedAt: text('scanned_at').notNull(),     // ISO datetime
  signals: text('signals').notNull(),           // JSON array of EvidenceSignal
  analyses: text('analyses').notNull(),         // JSON array of EvidenceDeepAnalysis
  marketRegime: text('market_regime'),          // JSON object
  totalSymbols: integer('total_symbols').notNull().default(0),
  highConviction: integer('high_conviction').notNull().default(0),
  mediumConviction: integer('medium_conviction').notNull().default(0),
  withSignals: integer('with_signals').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Weekly picks (evidence-based swing setups per scan date) ---
export const weeklyPicks = sqliteTable('weekly_picks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanDate: text('scan_date').notNull(),       // YYYY-MM-DD
  symbol: text('symbol').notNull(),
  tier: text('tier', { enum: ['HIGH', 'MEDIUM'] }).notNull(),
  evidenceType: text('evidence_type').notNull(), // 'PEAD' | 'INSIDER' | 'OPTIONS' | 'PEAD_INSIDER' | 'FUNDAMENTAL'
  evidenceDetail: text('evidence_detail').notNull(),
  entryLow: real('entry_low').notNull(),
  entryHigh: real('entry_high').notNull(),
  stop: real('stop').notNull(),
  target: real('target').notNull(),
  rrRatio: real('rr_ratio').notNull(),
  regime: text('regime', { enum: ['bull', 'bear', 'neutral'] }).notNull(),
  sectorCategory: text('sector_category', { enum: ['LEADING', 'NEUTRAL', 'LAGGING'] }).notNull(),
  aiVerdict: text('ai_verdict', { enum: ['BUY_SETUP', 'WAIT', 'PASS'] }),
  fundamentalScore: integer('fundamental_score').notNull(),
  technicalScore: integer('technical_score').notNull(),
  outcome30d: real('outcome_30d'),
  outcome90d: real('outcome_90d'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Macro Intelligence ---
export const macroEvents = sqliteTable('macro_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  event: text('event').notNull(),
  category: text('category').notNull(),
  magnitude: text('magnitude', { enum: ['high', 'medium', 'low'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const causalChains = sqliteTable('causal_chains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  ticker: text('ticker').notNull(),
  category: text('category').notNull(),
  direction: text('direction', { enum: ['positive', 'negative'] }).notNull(),
  impact: text('impact', { enum: ['direct', 'indirect'] }).notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  // Outcome resolution (¿la dirección predicha acertó?) — NULL = sin resolver aún
  entryPrice: real('entry_price'),                     // precio en la fecha del evento
  resolutionPrice: real('resolution_price'),
  resolutionReturn: real('resolution_return'),         // % vs entryPrice
  outcome: text('outcome'),                            // 'correct' | 'incorrect' | 'neutral'
  resolvedAt: text('resolved_at'),
});

export const eventRelations = sqliteTable('event_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  relatedEventId: text('related_event_id').notNull(),
});

// --- Event study: playbook empírico (evento de mercado → reacción sectorial medida) ---
export const eventSectorReactions = sqliteTable('event_sector_reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),     // oil_shock_up | rate_spike | risk_off | ...
  target: text('target').notNull(),            // ETF sectorial / ticker
  horizonDays: integer('horizon_days').notNull(),
  reactionAvg: real('reaction_avg').notNull(), // retorno medio del target tras el evento
  baselineAvg: real('baseline_avg').notNull(), // retorno medio incondicional (línea base)
  edge: real('edge').notNull(),                // reaction − baseline
  winRate: integer('win_rate').notNull(),
  tStat: real('t_stat').notNull(),
  significant: integer('significant', { mode: 'boolean' }).notNull().default(false),
  nEvents: integer('n_events').notNull(),
  computedAt: text('computed_at').notNull().default(sql`(datetime('now'))`),
});

// Radar de ciclos cuantitativo: snapshot diario por canasta (ETF). Contexto, no señal.
export const cycleRadarSnapshots = sqliteTable('cycle_radar_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotDate: text('snapshot_date').notNull(), // YYYY-MM-DD
  symbol: text('symbol').notNull(),
  label: text('label').notNull(),
  categoria: text('categoria', { enum: ['pais', 'sector'] }).notNull(),
  close: real('close').notNull(),
  sma200: real('sma200'),
  distSma200Pct: real('dist_sma200_pct'),
  ret3m: real('ret_3m'),
  ret6m: real('ret_6m'),
  rs3m: real('rs_3m'),
  rs6m: real('rs_6m'),
  sesionesEnLado: integer('sesiones_en_lado'),
  ladoSma: text('lado_sma', { enum: ['arriba', 'abajo'] }),
  sharesOutstanding: real('shares_outstanding'), // shares IMPLÍCITAS (totalAssets/close), nunca el sharesOutstanding real de Yahoo — ver cycle-radar.service.ts
  flowDelta20d: real('flow_delta_20d'),
  cycleState: text('cycle_state', { enum: ['girando', 'odiado', 'tendencia', 'extendido', 'neutro'] }),
  stateReason: text('state_reason'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('cycle_radar_date_symbol_uq').on(t.snapshotDate, t.symbol)]);
