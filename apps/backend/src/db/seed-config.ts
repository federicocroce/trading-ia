import { db, schema } from './index.js';

export function seedConfigTables() {
  console.log('[Seed] Poblando tablas de configuración...');

  // Note: thematic_queries seeding is handled by seedConfigIfEmpty() in config.repository.ts
  // which uses the richer DEFAULT_THEMATIC_QUERIES set.

  const existingSources = db.select().from(schema.newsSources).all();
  if (existingSources.length === 0) {
    const sources = [
      { name: 'CNBC Top News', type: 'rss' as const, url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', priority: 1 },
      { name: 'Yahoo Finance S&P', type: 'rss' as const, url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US', priority: 2 },
      { name: 'MarketWatch', type: 'rss' as const, url: 'https://feeds.marketwatch.com/marketwatch/topstories/', priority: 3 },
      { name: 'Investing.com', type: 'rss' as const, url: 'https://www.investing.com/rss/news.rss', priority: 4 },
      { name: 'NewsAPI', type: 'newsapi' as const, url: undefined, priority: 5 },
      { name: 'Finnhub', type: 'finnhub' as const, url: undefined, priority: 6 },
    ];
    for (const s of sources) {
      db.insert(schema.newsSources).values({ ...s, url: s.url ?? null }).run();
    }
  }

  const existingKeywords = db.select().from(schema.newsSearchKeywords).all();
  if (existingKeywords.length === 0) {
    const searchKeywords = [
      { keyword: 'stock market', category: 'general', priority: 1 },
      { keyword: 'oil price', category: 'energy', priority: 2 },
      { keyword: 'cryptocurrency', category: 'crypto', priority: 3 },
      { keyword: 'Argentina economy', category: 'argentina', priority: 4 },
      { keyword: 'Vaca Muerta', category: 'argentina', priority: 5 },
      { keyword: 'energy sector', category: 'energy', priority: 6 },
      { keyword: 'Federal Reserve', category: 'macro', priority: 7 },
      { keyword: 'interest rate', category: 'macro', priority: 8 },
      { keyword: 'S&P 500', category: 'general', priority: 9 },
      { keyword: 'Bitcoin', category: 'crypto', priority: 10 },
      { keyword: 'Ethereum', category: 'crypto', priority: 11 },
    ];
    for (const k of searchKeywords) {
      db.insert(schema.newsSearchKeywords).values(k).run();
    }
  }

  const existingSentiment = db.select().from(schema.sentimentKeywords).all();
  if (existingSentiment.length === 0) {
    const positiveEn = [
      'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains', 'jump', 'jumps',
      'rise', 'rises', 'climb', 'climbs', 'boost', 'record high', 'all-time high', 'breakout',
      'upgrade', 'upgrades', 'outperform', 'beat', 'beats', 'strong', 'bullish', 'upbeat',
      'recovery', 'recovers', 'profit', 'profits', 'dividend', 'buyback', 'growth',
      'positive', 'optimism', 'optimistic', 'momentum', 'opportunity', 'upside',
      'acquisition', 'merger', 'partnership', 'expansion', 'innovation',
      'revenue beat', 'earnings beat', 'guidance raise', 'margin expansion',
      'short squeeze', 'golden cross', 'accumulation', 'inflows', 'rebound',
      'approval', 'contract win', 'price target raise', 'overweight',
      'buyback program', 'special dividend', 'stock split',
    ];
    const positiveEs = [
      'sube', 'suba', 'alcista', 'récord', 'crece', 'crecimiento', 'ganancias',
      'mejora', 'repunte', 'impulso', 'oportunidad', 'recuperacion', 'expansion',
      'licitacion exitosa', 'flujo de capitales', 'superavit', 'desregulacion',
      'acuerdo comercial', 'inversion extranjera', 'produccion record',
    ];
    const negativeEn = [
      'crash', 'crashes', 'plunge', 'plunges', 'drop', 'drops', 'fall', 'falls', 'sink', 'sinks',
      'decline', 'declines', 'tumble', 'tumbles', 'slump', 'loss', 'losses', 'sell-off', 'selloff',
      'downgrade', 'downgrades', 'underperform', 'miss', 'misses', 'weak', 'bearish',
      'risk', 'risks', 'warning', 'warns', 'fear', 'fears', 'crisis', 'recession',
      'bankruptcy', 'default', 'layoff', 'layoffs', 'cut', 'cuts', 'fraud', 'investigation',
      'sanction', 'sanctions', 'tariff', 'tariffs', 'inflation', 'shutdown',
      'profit warning', 'guidance cut', 'margin compression', 'debt restructuring',
      'death cross', 'distribution', 'outflows', 'delisting', 'sec probe',
      'class action', 'recall', 'supply disruption', 'margin call',
      'price target cut', 'underweight', 'downside', 'headwinds',
    ];
    const negativeEs = [
      'baja', 'bajista', 'caída', 'pérdida', 'pérdidas', 'riesgo', 'crisis',
      'toma de ganancias', 'presion vendedora', 'riesgo pais', 'dolar blue',
      'brecha cambiaria', 'cepo', 'default', 'devaluacion', 'inflacion',
      'conflicto gremial', 'paro', 'embargo', 'deuda soberana',
    ];
    const highImpactTerms = new Set([
      'crash', 'surge', 'record', 'all-time', 'bankruptcy', 'merger', 'acquisition',
      'fed', 'interest rate', 'earnings', 'guidance', 'tariff', 'sanction', 'war',
      'crisis', 'default', 'rally', 'breakout', 'plunge',
      'fed rate', 'rate cut', 'rate hike', 'quantitative', 'stimulus',
      'opec', 'embargo', 'invasion', 'ceasefire', 'election',
      'devaluation', 'devaluacion', 'riesgo pais',
    ]);

    for (const kw of positiveEn) {
      db.insert(schema.sentimentKeywords).values({ keyword: kw, language: 'en', sentiment: 'positive', impactLevel: highImpactTerms.has(kw) ? 'high' : null }).run();
    }
    for (const kw of positiveEs) {
      db.insert(schema.sentimentKeywords).values({ keyword: kw, language: 'es', sentiment: 'positive', impactLevel: highImpactTerms.has(kw) ? 'high' : null }).run();
    }
    for (const kw of negativeEn) {
      db.insert(schema.sentimentKeywords).values({ keyword: kw, language: 'en', sentiment: 'negative', impactLevel: highImpactTerms.has(kw) ? 'high' : null }).run();
    }
    for (const kw of negativeEs) {
      db.insert(schema.sentimentKeywords).values({ keyword: kw, language: 'es', sentiment: 'negative', impactLevel: highImpactTerms.has(kw) ? 'high' : null }).run();
    }
  }

  const existingSectorTickers = db.select().from(schema.sectorTickers).all();
  if (existingSectorTickers.length === 0) {
    const sectorTickersData = [
      { sector: 'Defensa', ticker: 'LMT', relevance: 'primary' as const },
      { sector: 'Defensa', ticker: 'RTX', relevance: 'primary' as const },
      { sector: 'Defensa', ticker: 'NOC', relevance: 'primary' as const },
      { sector: 'Defensa', ticker: 'GD', relevance: 'secondary' as const },
      { sector: 'Defensa', ticker: 'BA', relevance: 'secondary' as const },
      { sector: 'Semiconductores', ticker: 'NVDA', relevance: 'primary' as const },
      { sector: 'Semiconductores', ticker: 'TSM', relevance: 'primary' as const },
      { sector: 'Semiconductores', ticker: 'AMD', relevance: 'primary' as const },
      { sector: 'Semiconductores', ticker: 'INTC', relevance: 'secondary' as const },
      { sector: 'Semiconductores', ticker: 'ASML', relevance: 'secondary' as const },
      { sector: 'Petroleo', ticker: 'XOM', relevance: 'primary' as const },
      { sector: 'Petroleo', ticker: 'CVX', relevance: 'primary' as const },
      { sector: 'Petroleo', ticker: 'COP', relevance: 'primary' as const },
      { sector: 'Petroleo', ticker: 'SLB', relevance: 'secondary' as const },
      { sector: 'Petroleo', ticker: 'OXY', relevance: 'secondary' as const },
      { sector: 'Banca', ticker: 'JPM', relevance: 'primary' as const },
      { sector: 'Banca', ticker: 'BAC', relevance: 'primary' as const },
      { sector: 'Banca', ticker: 'GS', relevance: 'primary' as const },
      { sector: 'Banca', ticker: 'GGAL', relevance: 'primary' as const },
      { sector: 'Banca', ticker: 'BMA', relevance: 'primary' as const },
      { sector: 'Tech/IA', ticker: 'MSFT', relevance: 'primary' as const },
      { sector: 'Tech/IA', ticker: 'GOOGL', relevance: 'primary' as const },
      { sector: 'Tech/IA', ticker: 'AMZN', relevance: 'primary' as const },
      { sector: 'Tech/IA', ticker: 'META', relevance: 'primary' as const },
      { sector: 'Tech/IA', ticker: 'AAPL', relevance: 'primary' as const },
      { sector: 'Crypto', ticker: 'COIN', relevance: 'primary' as const },
      { sector: 'Crypto', ticker: 'MARA', relevance: 'primary' as const },
      { sector: 'Crypto', ticker: 'RIOT', relevance: 'secondary' as const },
      { sector: 'Crypto', ticker: 'MSTR', relevance: 'secondary' as const },
      { sector: 'Pharma', ticker: 'PFE', relevance: 'primary' as const },
      { sector: 'Pharma', ticker: 'JNJ', relevance: 'primary' as const },
      { sector: 'Pharma', ticker: 'LLY', relevance: 'primary' as const },
      { sector: 'Pharma', ticker: 'ABBV', relevance: 'secondary' as const },
      { sector: 'Pharma', ticker: 'MRK', relevance: 'secondary' as const },
      { sector: 'Cybersecurity', ticker: 'CRWD', relevance: 'primary' as const },
      { sector: 'Cybersecurity', ticker: 'PANW', relevance: 'primary' as const },
      { sector: 'Cybersecurity', ticker: 'FTNT', relevance: 'secondary' as const },
      { sector: 'Cybersecurity', ticker: 'ZS', relevance: 'secondary' as const },
    ];
    for (const st of sectorTickersData) {
      db.insert(schema.sectorTickers).values(st).run();
    }
  }

  console.log('[Seed] Tablas de configuración pobladas.');
}
