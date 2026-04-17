import type { MarketReport, MarketReportRecommendation, FundamentalData, UnifiedAssetAnalysis } from '@trading/shared';
import { MARKET_REPORT_PROMPT, REPORT_SYNTHESIS_PROMPT } from '@trading/shared';
import { callAI, callAIWithModel } from '../shared/ai-router.js';
import {
  getNewsArticlesSince,
  getNewsArticlesForToday,
  getActiveMarketThemes,
  getSectorImpactsForToday,
  getOpportunitySnapshotsForLatestScan,
  getSymbolsByType,
  getFundamentalFromCache,
  upsertFundamentalCache,
} from '../db/repository.js';
import { getPortfolioPositions, getActiveSymbolList, getAllSymbols } from '../db/repository.js';
import { getQuotes, getFundamentals } from '../shared/yahoo.js';
import { registerNovelTickers, getDiscoveredTickers } from '../discovery/discovery-registry.js';
import { classifyAsset } from '../discovery/asset-classifier.js';
import {
  getTodayMarketReport,
  getLatestMarketReport,
  saveMarketReport,
} from './pipeline.repository.js';

export function getCachedMarketReport(): MarketReport | null {
  const row = getTodayMarketReport();
  if (!row) return null;
  return {
    generatedAt: row.generatedAt ? new Date(row.generatedAt).getTime() : Date.now(),
    macroContext: row.macroContext ?? '',
    portfolioImpact: row.portfolioImpact ?? '',
    themes: (row.themes as MarketReport['themes']) ?? [],
    topRecommendations: (row.topRecommendations as MarketReport['topRecommendations']) ?? [],
    alternatives: (row.alternatives as MarketReport['alternatives']) ?? [],
    scenarios: (row.scenarios as MarketReport['scenarios']) ?? [],
    avoidList: (row.avoidList as string[]) ?? [],
    engine: row.engine ?? 'groq-pipeline-thematic',
    status: (row.status as MarketReport['status']) ?? 'ok',
    errors: (row.errors as string[]) ?? [],
  };
}

// ============================================================
// THEMATIC NEWS SEARCH (Pasada 0)
// ============================================================

const THEMATIC_QUERIES = [
  { theme: 'Geopolítica y conflictos', query: 'war conflict sanctions geopolitics military defense' },
  { theme: 'Política monetaria', query: 'Federal Reserve interest rate inflation central bank ECB' },
  { theme: 'Tecnología e IA', query: 'artificial intelligence AI semiconductor earnings tech NVIDIA' },
  { theme: 'Energía y petróleo', query: 'oil price OPEC crude energy natural gas renewable' },
  { theme: 'Mercados emergentes y Argentina', query: 'Argentina IMF emerging markets Latin America Brazil' },
  { theme: 'Comercio y aranceles', query: 'tariffs trade war China imports exports supply chain' },
  { theme: 'Crypto y fintech', query: 'Bitcoin cryptocurrency blockchain DeFi regulation SEC crypto' },
  { theme: 'Salud y pharma', query: 'FDA approval pharmaceutical biotech drug healthcare' },
  { theme: 'Commodities', query: 'gold copper lithium uranium commodities mining metals' },
  { theme: 'M&A y earnings', query: 'merger acquisition earnings report revenue guidance IPO' },
];

async function fetchThematicNewsFromAPI(): Promise<Array<{ theme: string; headlines: string[] }>> {
  console.log('[MarketReport] Pasada 0 (API fallback): Buscando noticias por temática...');
  const newsapiKey = process.env.NEWSAPI_API_KEY;
  const results: Array<{ theme: string; headlines: string[] }> = [];

  if (!newsapiKey) {
    console.warn('[MarketReport] NEWSAPI_API_KEY no configurada, saltando búsqueda temática');
    return results;
  }

  // Fetch in batches of 3 to respect rate limits (100 req/day on free tier)
  for (let i = 0; i < THEMATIC_QUERIES.length; i += 3) {
    const batch = THEMATIC_QUERIES.slice(i, i + 3);
    const fetches = await Promise.allSettled(
      batch.map(async ({ theme, query }) => {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${newsapiKey}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return { theme, headlines: [] as string[] };
          const data = (await res.json()) as any;
          if (data.status !== 'ok') return { theme, headlines: [] as string[] };
          const headlines = (data.articles ?? [])
            .filter((a: any) => a.title && a.title !== '[Removed]')
            .map((a: any) => a.title as string)
            .slice(0, 5);
          return { theme, headlines };
        } catch {
          return { theme, headlines: [] as string[] };
        }
      }),
    );

    for (const r of fetches) {
      if (r.status === 'fulfilled' && r.value.headlines.length > 0) {
        results.push(r.value);
      }
    }
  }

  const total = results.reduce((sum, r) => sum + r.headlines.length, 0);
  console.log(`[MarketReport] Pasada 0 (API): ${total} noticias en ${results.length} tematicas`);
  return results;
}

/**
 * Pasada 0: Build news context from DB first, fall back to NewsAPI if insufficient.
 */
async function getNewsContext(): Promise<{ dbHeadlines: string[]; thematicContext: Array<{ theme: string; headlines: string[] }> }> {
  console.log('[MarketReport] Pasada 0: Construyendo contexto de noticias desde DB...');

  // Read today's articles from DB (medium or high impact)
  const todayArticles = getNewsArticlesForToday('medium');
  const dbHeadlines = todayArticles
    .map(a => `- ${a.title} [${(a as any).sentiment ?? '?'}] (${(a as any).source ?? ''})`)
    .slice(0, 30);

  console.log(`[MarketReport] Pasada 0: ${dbHeadlines.length} artículos de DB`);

  // Get active market themes from DB for keyword-based classification
  const activeThemes = getActiveMarketThemes();
  const thematicContext: Array<{ theme: string; headlines: string[] }> = [];

  if (dbHeadlines.length >= 10 && activeThemes.length > 0) {
    // Classify DB articles by theme using keyword matching
    for (const dbTheme of activeThemes) {
      const keywords: string[] = (dbTheme as any).keywords
        ? ((dbTheme as any).keywords as string).toLowerCase().split(',').map((k: string) => k.trim()).filter(Boolean)
        : [(dbTheme.name ?? '').toLowerCase()];

      const matchingHeadlines = todayArticles
        .filter(a => {
          const text = `${a.title} ${(a as any).summary ?? ''}`.toLowerCase();
          return keywords.some(kw => kw && text.includes(kw));
        })
        .map(a => a.title)
        .slice(0, 5);

      if (matchingHeadlines.length > 0) {
        thematicContext.push({ theme: dbTheme.name, headlines: matchingHeadlines });
      }
    }
    console.log(`[MarketReport] Pasada 0 (DB): clasificados en ${thematicContext.length} temas`);
  } else {
    // Fall back to NewsAPI if fewer than 10 articles in DB
    console.log(`[MarketReport] Pasada 0: DB insuficiente (${dbHeadlines.length} arts), usando NewsAPI fallback`);
    const apiResults = await fetchThematicNewsFromAPI();
    thematicContext.push(...apiResults);
  }

  return { dbHeadlines, thematicContext };
}

// ============================================================
// PASADA 1: Identificar temáticas activas
// ============================================================

interface ThemeAnalysis {
  theme: string;
  relevance: 'high' | 'medium' | 'low';
  summary: string;
  sectors: string[];
  suggestedTickers: string[];
}

async function identifyActiveThemes(
  dbHeadlines: string[],
  thematicNews: Array<{ theme: string; headlines: string[] }>,
): Promise<ThemeAnalysis[]> {
  console.log('[MarketReport] Pasada 1: Identificando temáticas activas...');

  const allContext: string[] = [];

  // DB news (already collected)
  if (dbHeadlines.length > 0) {
    allContext.push('NOTICIAS EN BASE DE DATOS (de fuentes habituales):');
    allContext.push(...dbHeadlines.slice(0, 15));
  }

  // Thematic news (new searches or DB-classified)
  for (const { theme, headlines } of thematicNews) {
    if (headlines.length > 0) {
      allContext.push(`\nTEMA "${theme}":`);
      allContext.push(...headlines.map(h => `- ${h}`));
    }
  }

  // Enrich with sector impacts from DB
  const sectorImpacts = getSectorImpactsForToday();
  if (sectorImpacts.length > 0) {
    allContext.push('\nIMPACTOS SECTORIALES IDENTIFICADOS HOY:');
    for (const si of sectorImpacts) {
      allContext.push(`- ${si.sector} [${si.impact}]: ${si.event} (confianza: ${si.confidence})`);
    }
  }

  // Enrich with opportunity snapshots from DB
  const snapshots = getOpportunitySnapshotsForLatestScan();
  if (snapshots.length > 0) {
    const topSnapshots = snapshots
      .sort((a, b) => ((b as any).score ?? 0) - ((a as any).score ?? 0))
      .slice(0, 10);
    allContext.push('\nOPORTUNIDADES DETECTADAS (último scan):');
    for (const snap of topSnapshots) {
      allContext.push(`- ${snap.symbol}: score ${(snap as any).score ?? 'N/A'}, sector ${(snap as any).sector ?? 'N/A'}`);
    }
  }

  // Build CEDEAR/ADR list from DB
  const adrSymbols = getSymbolsByType('adr').map(s => s.symbol).join(', ');

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos deben estar en español. Prohibido usar inglés.

Sos un analista de mercado. Te doy noticias agrupadas por tematica. Tu trabajo:

1. Identifica las 4-6 TEMATICAS MAS RELEVANTES para un swing trader (no todas, solo las que impactan inversiones).
2. Para cada tematica, determina:
   - "theme": nombre de la tematica
   - "relevance": "high" si es urgente/impacta precios ya, "medium" si es importante pero no urgente, "low" si es ruido
   - "summary": 2-3 oraciones explicando que pasa y POR QUE importa para invertir
   - "sectors": sectores/industrias afectados (ej: "Defensa", "Semiconductores", "Banca argentina")
   - "suggestedTickers": 3-5 tickers CONCRETOS que se benefician o perjudican. Usa tickers reales de NYSE/NASDAQ.

REGLAS:
- NO incluyas tematicas sin impacto en inversiones
- Se especifico: no "tecnologia" sino "semiconductores por restricciones a China" o "AI por earnings de NVDA"
- Incluye tematicas positivas Y negativas
- CEDEARs/ADRs disponibles en Argentina: ${adrSymbols || 'LMT, RTX, NOC, NVDA, TSM, AAPL, MSFT, GOOGL, AMZN, META, TSLA, XOM, CVX, MELI, NU, CRWD, PLTR, INTC, AMD'}

Responde SOLO con JSON:
{"themes":[{"theme":"...","relevance":"high","summary":"...","sectors":["..."],"suggestedTickers":["LMT","RTX"]}]}`;

  const raw = await callAI('reasoning',allContext.join('\n'), prompt, 4096);
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed.themes) ? parsed.themes : [];
}

// ============================================================
// PASADA 2: Análisis profundo por temática
// ============================================================

interface ThemeDeepAnalysis {
  theme: string;
  recommendations: Array<{
    symbol: string;
    name: string;
    instrumentType: string;
    sector: string;
    thesis: string;
    catalysts: string[];
    risks: string[];
    suggestedWeight: number;
  }>;
}

async function analyzeThemeDeep(
  theme: ThemeAnalysis,
  tickerData: Map<string, { price: number; fundamentals: FundamentalData; name: string }>,
): Promise<ThemeDeepAnalysis> {
  // Build data context for this theme's tickers
  const tickerLines: string[] = [];
  for (const symbol of theme.suggestedTickers) {
    const data = tickerData.get(symbol);
    if (!data) continue;
    const f = data.fundamentals;
    let line = `${symbol} (${data.name}): $${data.price.toFixed(2)}`;
    if (f.peRatio != null) line += `, P/E: ${f.peRatio.toFixed(1)}`;
    if (f.forwardPE != null) line += `, Fwd P/E: ${f.forwardPE.toFixed(1)}`;
    if (f.eps != null) line += `, EPS: ${f.eps.toFixed(2)}`;
    if (f.dividendYield != null && f.dividendYield > 0) line += `, Div: ${(f.dividendYield * 100).toFixed(1)}%`;
    if (f.priceVs52wHigh != null) line += `, vs 52wH: ${f.priceVs52wHigh.toFixed(1)}%`;
    if (f.marketCap != null) line += `, MCap: $${(f.marketCap / 1e9).toFixed(1)}B`;
    tickerLines.push(line);
  }

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos (thesis, catalysts, risks, name, sector) deben estar en español. Prohibido usar inglés.

Sos un analista de inversiones senior. Analiza esta TEMATICA ESPECIFICA para un swing trader argentino.

TEMATICA: ${theme.theme}
CONTEXTO: ${theme.summary}
SECTORES: ${theme.sectors.join(', ')}

DATOS REALES de Yahoo Finance:
${tickerLines.join('\n')}

Para cada ticker, genera:
- "symbol", "name", "instrumentType" (CEDEAR/Accion US/ETF/Crypto)
- "sector": sector especifico (no generico)
- "thesis": 2-3 oraciones ESPECIFICAS. Menciona datos concretos (P/E, % vs 52w high, earnings). Conecta directamente con la tematica.
- "catalysts": 2-3 catalizadores proximos meses vinculados a esta tematica
- "risks": 1-2 riesgos especificos
- "suggestedWeight": % del capital (los de esta tematica suman ~${Math.round(theme.relevance === 'high' ? 30 : theme.relevance === 'medium' ? 20 : 10)}%)

NO seas generico. "La demanda de tecnologia esta aumentando" NO sirve. "NVDA corrigio 18% desde maximos y su Forward P/E de 25 vs trailing 35 implica crecimiento de earnings del 40%, impulsado por gasto de $100B en AI de hyperscalers" SI sirve.

Responde SOLO con JSON:
{"recommendations":[{"symbol":"...","name":"...","instrumentType":"...","sector":"...","thesis":"...","catalysts":["..."],"risks":["..."],"suggestedWeight":10}]}`;

  const raw = await callAI('reasoning','Analiza los tickers de esta tematica con los datos reales proporcionados.', prompt, 3072);
  const parsed = JSON.parse(raw);

  return {
    theme: theme.theme,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
  };
}

// ============================================================
// PASADA 3: Enriquecer con datos reales
// ============================================================

async function enrichWithRealData(tickers: string[]): Promise<Map<string, { price: number; fundamentals: FundamentalData; name: string }>> {
  console.log(`[MarketReport] Pasada 3: Enriqueciendo ${tickers.length} tickers con datos reales...`);
  const enriched = new Map<string, { price: number; fundamentals: FundamentalData; name: string }>();

  const quotes = await getQuotes(tickers);

  // Separate tickers with cached fundamentals from those needing a Yahoo Finance fetch
  const tickersNeedingFetch: string[] = [];
  const cachedFundamentals = new Map<string, FundamentalData>();

  for (const symbol of tickers) {
    const cached = getFundamentalFromCache(symbol);
    if (cached) {
      try {
        cachedFundamentals.set(symbol, JSON.parse(cached) as FundamentalData);
      } catch {
        tickersNeedingFetch.push(symbol);
      }
    } else {
      tickersNeedingFetch.push(symbol);
    }
  }

  if (tickersNeedingFetch.length > 0) {
    console.log(`[MarketReport] Pasada 3: ${tickersNeedingFetch.length} tickers sin cache — fetching Yahoo Finance`);
  } else {
    console.log(`[MarketReport] Pasada 3: todos los fundamentales en cache`);
  }

  // Populate cached tickers first
  for (const [symbol, fund] of cachedFundamentals) {
    const classification = await classifyAsset(symbol).catch(() => null);
    const quote = quotes.find(q => q.symbol === symbol);
    const price = quote?.current ?? fund.currentPrice ?? 0;
    if (price > 0) {
      enriched.set(symbol, { price, fundamentals: fund, name: classification?.name ?? symbol });
    }
  }

  // Fetch remaining from Yahoo Finance (batch 5 at a time)
  for (let i = 0; i < tickersNeedingFetch.length; i += 5) {
    const batch = tickersNeedingFetch.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(async (symbol) => {
      const fund = await getFundamentals(symbol);
      // Persist to cache for future runs
      upsertFundamentalCache(symbol, JSON.stringify(fund));
      const classification = await classifyAsset(symbol).catch(() => null);
      const quote = quotes.find(q => q.symbol === symbol);
      return {
        symbol,
        price: quote?.current ?? fund.currentPrice ?? 0,
        fundamentals: fund,
        name: classification?.name ?? symbol,
      };
    }));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.price > 0) {
        enriched.set(r.value.symbol, r.value);
      }
    }
  }

  console.log(`[MarketReport] Enriquecidos: ${enriched.size}/${tickers.length}`);
  return enriched;
}

// ============================================================
// PASADA 4: Consolidar reporte final
// ============================================================

async function consolidateFinalReport(
  themes: ThemeAnalysis[],
  themeAnalyses: ThemeDeepAnalysis[],
  portfolioContext: string,
  headlines: string[],
): Promise<MarketReport> {
  console.log('[MarketReport] Pasada 4: Consolidando reporte final...');

  // Merge all recommendations from all themes
  const allRecs: MarketReportRecommendation[] = [];
  for (const analysis of themeAnalyses) {
    for (const rec of analysis.recommendations) {
      // Avoid duplicates
      if (!allRecs.find(r => r.symbol === rec.symbol)) {
        allRecs.push({
          symbol: rec.symbol ?? '',
          name: rec.name ?? rec.symbol ?? '',
          instrumentType: rec.instrumentType ?? 'Accion US',
          sector: rec.sector ?? 'Otros',
          thesis: rec.thesis ?? '',
          catalysts: Array.isArray(rec.catalysts) ? rec.catalysts : [],
          risks: Array.isArray(rec.risks) ? rec.risks : [],
          suggestedWeight: rec.suggestedWeight ?? 0,
        });
      }
    }
  }

  // Build final context for consolidation
  const themeSummaries = themes
    .filter(t => t.relevance !== 'low')
    .map(t => `[${t.relevance.toUpperCase()}] ${t.theme}: ${t.summary}`)
    .join('\n');

  const prompt = `Sos un estratega de mercado senior consolidando un reporte para un swing trader argentino.

Ya analizamos ${themes.length} tematicas y tenemos ${allRecs.length} recomendaciones. Tu trabajo es CONSOLIDAR:

1. "macroContext": 4-6 oraciones integrando TODAS las tematicas. No te enfoques en una sola — menciona la interaccion entre ellas.
2. "portfolioImpact": como impactan estas tematicas al portfolio actual del trader.
3. "scenarios": 2-3 escenarios globales con distribuciones. Cada escenario debe cubrir multiples tematicas.
4. "avoidList": 3-4 cosas que NO haria, con razon especifica.

Las recomendaciones ya estan generadas, no las cambies. Solo genera el contexto integrador.

Responde SOLO con JSON:
{"macroContext":"...","portfolioImpact":"...","scenarios":[{"name":"...","probability":40,"distribution":[{"symbol":"LMT","weight":20,"reason":"..."}]}],"avoidList":["..."]}`;

  const userMsg = [
    `TEMATICAS ANALIZADAS:`,
    themeSummaries,
    '',
    portfolioContext,
    '',
    `TOP HEADLINES:`,
    ...headlines.slice(0, 10),
  ].join('\n');

  const raw = await callAI('reasoning',userMsg, prompt, 4096);
  const parsed = JSON.parse(raw);

  // Sort recommendations: high relevance themes first, then by weight
  const themeRelevanceMap = new Map(themes.map(t => [t.theme, t.relevance]));
  allRecs.sort((a, b) => (b.suggestedWeight ?? 0) - (a.suggestedWeight ?? 0));

  // Build alternatives from lower-weight recs
  const topRecs = allRecs.slice(0, 8);
  const alternatives = allRecs.slice(8).map((r, i) => ({
    tier: (i < 3 ? 'A' : 'B') as 'A' | 'B',
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    thesis: r.thesis,
  }));

  // Build theme sections with their own recommendations
  const reportThemes = themes.map(t => {
    const analysis = themeAnalyses.find(a => a.theme === t.theme);
    const recs: MarketReportRecommendation[] = (analysis?.recommendations ?? []).map(rec => ({
      symbol: rec.symbol ?? '',
      name: rec.name ?? rec.symbol ?? '',
      instrumentType: rec.instrumentType ?? 'Accion US',
      sector: rec.sector ?? 'Otros',
      thesis: rec.thesis ?? '',
      catalysts: Array.isArray(rec.catalysts) ? rec.catalysts : [],
      risks: Array.isArray(rec.risks) ? rec.risks : [],
      suggestedWeight: rec.suggestedWeight ?? 0,
    }));
    return {
      theme: t.theme,
      relevance: t.relevance,
      summary: t.summary,
      sectors: t.sectors,
      recommendations: recs,
    };
  });

  return {
    generatedAt: Date.now(),
    macroContext: parsed.macroContext ?? themeSummaries,
    portfolioImpact: parsed.portfolioImpact ?? '',
    themes: reportThemes,
    topRecommendations: topRecs,
    alternatives,
    scenarios: Array.isArray(parsed.scenarios)
      ? parsed.scenarios.map((s: any) => ({
          name: s.name ?? '',
          probability: s.probability ?? 0,
          distribution: Array.isArray(s.distribution)
            ? s.distribution.map((d: any) => ({ symbol: d.symbol ?? '', weight: d.weight ?? 0, reason: d.reason ?? '' }))
            : [],
        }))
      : [],
    avoidList: Array.isArray(parsed.avoidList) ? parsed.avoidList : [],
    engine: 'groq-pipeline-thematic',
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Normalize LLM-generated macroTheme strings to canonical Spanish names.
 * Prevents theme fragmentation across pipeline runs (e.g. "Semiconductores" vs "AI/Chips").
 */
function normalizeMacroTheme(theme: string | null): string {
  if (!theme) return 'Otros';
  const t = theme.toLowerCase().trim();

  if (t.includes('semiconductor') || t.includes('chip') || t.includes('nvda') ||
      t.includes('ai/') || t.includes('inteligencia artificial')) return 'Semiconductores / IA';
  if (t.includes('petróleo') || t.includes('petroleo') || t.includes('oil') ||
      t.includes('energía') || t.includes('energia') || t.includes('opec')) return 'Energía';
  if (t.includes('argentina') || t.includes('cedear') || t.includes('merval') ||
      t.includes('emergente') || t.includes('latam')) return 'Argentina / Emergentes';
  if (t.includes('crypto') || t.includes('cripto') || t.includes('bitcoin') ||
      t.includes('blockchain')) return 'Cripto';
  if (t.includes('defensa') || t.includes('defense') || t.includes('geopolít') ||
      t.includes('guerra') || t.includes('conflicto')) return 'Defensa / Geopolítica';
  if (t.includes('banco') || t.includes('bank') || t.includes('finanzas') ||
      t.includes('finance')) return 'Finanzas';
  if (t.includes('farma') || t.includes('pharma') || t.includes('salud') ||
      t.includes('health') || t.includes('biotech')) return 'Salud / Farmacéutica';

  return theme.trim();
}

/**
 * Normalize scenario probabilities to sum ~100% and distribution weights per scenario.
 */
function normalizeScenarios(scenarios: MarketReport['scenarios']): MarketReport['scenarios'] {
  if (!scenarios || scenarios.length === 0) return scenarios;

  const totalProb = scenarios.reduce((sum, s) => sum + (s.probability ?? 0), 0);
  if (totalProb > 0 && Math.abs(totalProb - 100) > 5) {
    scenarios = scenarios.map(s => ({
      ...s,
      probability: Math.round((s.probability ?? 0) / totalProb * 100),
    }));
  }

  return scenarios.map(s => {
    const totalWeight = (s.distribution ?? []).reduce((sum, d) => sum + (d.weight ?? 0), 0);
    if (totalWeight > 0 && Math.abs(totalWeight - 100) > 5) {
      return {
        ...s,
        distribution: s.distribution.map(d => ({
          ...d,
          weight: Math.round((d.weight ?? 0) / totalWeight * 100),
        })),
      };
    }
    return s;
  });
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function generateMarketReport(
  precomputedAnalyses?: Map<string, UnifiedAssetAnalysis>
): Promise<MarketReport> {
  console.log('[MarketReport] Starting thematic pipeline...');
  const startTime = Date.now();

  // Gather portfolio
  const positions = getPortfolioPositions();
  const symbols = getActiveSymbolList();
  const quotes = await getQuotes(symbols);
  const totalValue = positions.reduce((sum, p) => {
    const q = quotes.find(q => q.symbol === p.symbol);
    return sum + p.quantity * (q?.current ?? 0);
  }, 0);
  const portfolioContext = [
    `PORTFOLIO ($${totalValue.toFixed(0)} total):`,
    ...positions.map(p => {
      const q = quotes.find(q => q.symbol === p.symbol);
      const pnl = (((q?.current ?? 0) - p.avgCost) / p.avgCost * 100).toFixed(1);
      return `- ${p.symbol}: ${p.quantity} acc, $${(q?.current ?? 0).toFixed(2)}, P&L ${pnl}%`;
    }),
  ].join('\n');

  // Siempre necesitamos headlines para el synthesis (independiente del path)
  const todayArticles = getNewsArticlesForToday('medium');
  const dbHeadlines = todayArticles
    .map(a => `- ${a.title} [${(a as any).sentiment ?? '?'}]`)
    .slice(0, 20);

  // === PASADAS 1-2: Agrupar análisis o pipeline temático completo ===
  let themes: MarketReport['themes'];
  let allRecs: MarketReportRecommendation[];

  if (precomputedAnalyses && precomputedAnalyses.size > 0) {
    console.log(`[MarketReport] Usando ${precomputedAnalyses.size} análisis previos de STAGE 3`);

    // Build symbol metadata map from DB (sync) — fixes instrumentType always 'Accion US'
    const allDbSymbols = getAllSymbols();
    const symbolMetaMap = new Map<string, { name: string; instrumentType: string }>();
    for (const s of allDbSymbols) {
      let instrumentType = 'Accion US';
      if (s.plaza === 'argentina-cedears') instrumentType = 'CEDEAR';
      else if (s.type === 'crypto') instrumentType = 'Crypto';
      else if (s.plaza === 'etfs-sectors') instrumentType = 'ETF';
      symbolMetaMap.set(s.symbol, { name: s.name || s.symbol, instrumentType });
    }

    // Portfolio symbols — HOLD/WATCH included for portfolio positions
    const portfolioSymbolSet = new Set(positions.map(p => p.symbol));

    // Agrupar por macroTheme (normalized to avoid fragmentation)
    const themeMap = new Map<string, MarketReportRecommendation[]>();

    for (const [symbol, analysis] of precomputedAnalyses) {
      const isInPortfolio = portfolioSymbolSet.has(symbol);
      // Include portfolio assets even if HOLD/WATCH — exclude non-portfolio HOLD/WATCH
      if (!isInPortfolio && (analysis.action === 'HOLD' || analysis.action === 'WATCH')) continue;

      const theme = normalizeMacroTheme(analysis.macroTheme);
      if (!themeMap.has(theme)) themeMap.set(theme, []);

      const meta = symbolMetaMap.get(symbol);
      const weight = analysis.action === 'BUY' ? 10 : analysis.action === 'SELL' ? 0 : 5;

      themeMap.get(theme)!.push({
        symbol,
        name: meta?.name ?? symbol,
        instrumentType: meta?.instrumentType ?? 'Accion US',
        sector: theme,
        thesis: analysis.thesis,
        catalysts: analysis.catalysts,
        risks: analysis.risks,
        suggestedWeight: weight,
      });
    }

    themes = [...themeMap.entries()].map(([theme, recs]) => ({
      theme,
      relevance: (recs.some(r => (r.suggestedWeight ?? 0) > 0) ? 'high' : 'medium') as 'high' | 'medium' | 'low',
      summary: `${recs.length} activos analizados`,
      sectors: [],
      recommendations: recs,
    }));

    allRecs = [...themeMap.values()].flat()
      .filter(r => (r.suggestedWeight ?? 0) > 0)
      .sort((a, b) => (b.suggestedWeight ?? 0) - (a.suggestedWeight ?? 0));

    console.log(`[MarketReport] ${themes.length} temas, ${allRecs.length} recomendaciones desde análisis previos`);
  } else {
    // Fallback: pipeline temático completo (re-run de solo REPORT sin STAGE 3 previo)
    console.log('[MarketReport] Sin análisis previos — ejecutando pipeline temático completo');
    const { dbHeadlines: apiHeadlines, thematicContext } = await getNewsContext();
    const identifiedThemes = await identifyActiveThemes(apiHeadlines, thematicContext);

    if (identifiedThemes.length === 0) {
      throw new Error('No se identificaron temáticas relevantes. Probá de nuevo más tarde.');
    }

    const activeThemes = identifiedThemes.filter(t => t.relevance !== 'low');
    const allSuggestedTickers = [...new Set(identifiedThemes.flatMap(t => t.suggestedTickers))];
    const discoveredTickers = getDiscoveredTickers().map(t => t.symbol);
    const allTickers = [...new Set([...symbols, ...allSuggestedTickers, ...discoveredTickers])];
    const tickerData = await enrichWithRealData(allTickers);

    const themeAnalyses: ThemeDeepAnalysis[] = [];
    for (let i = 0; i < activeThemes.length; i += 2) {
      const batch = activeThemes.slice(i, i + 2);
      const results = await Promise.allSettled(
        batch.map(theme => analyzeThemeDeep(theme, tickerData))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') themeAnalyses.push(r.value);
      }
    }

    allRecs = [];
    for (const analysis of themeAnalyses) {
      for (const rec of analysis.recommendations) {
        if (!allRecs.find(r => r.symbol === rec.symbol)) {
          allRecs.push({
            symbol: rec.symbol ?? '',
            name: rec.name ?? rec.symbol ?? '',
            instrumentType: rec.instrumentType ?? 'Accion US',
            sector: rec.sector ?? 'Otros',
            thesis: rec.thesis ?? '',
            catalysts: Array.isArray(rec.catalysts) ? rec.catalysts : [],
            risks: Array.isArray(rec.risks) ? rec.risks : [],
            suggestedWeight: rec.suggestedWeight ?? 0,
          });
        }
      }
    }

    themes = identifiedThemes.map(t => {
      const analysis = themeAnalyses.find(a => a.theme === t.theme);
      return {
        theme: t.theme,
        relevance: t.relevance,
        summary: t.summary,
        sectors: t.sectors,
        recommendations: (analysis?.recommendations ?? []).map(rec => ({
          symbol: rec.symbol ?? '',
          name: rec.name ?? rec.symbol ?? '',
          instrumentType: rec.instrumentType ?? 'Accion US',
          sector: rec.sector ?? 'Otros',
          thesis: rec.thesis ?? '',
          catalysts: Array.isArray(rec.catalysts) ? rec.catalysts : [],
          risks: Array.isArray(rec.risks) ? rec.risks : [],
          suggestedWeight: rec.suggestedWeight ?? 0,
        })),
      };
    });
  }

  // === PASADA 3: Síntesis macro con REPORT_SYNTHESIS_PROMPT ===
  console.log('[MarketReport] Pasada 3: síntesis macro...');

  const themeSummaries = themes
    .map(t => `[${(t.relevance ?? 'med').toUpperCase()}] ${t.theme}: ${t.summary} (${t.recommendations.length} activos)`)
    .join('\n');

  const topSymbols = allRecs.slice(0, 8).map(r =>
    `${r.symbol}: ${(r.thesis ?? '').slice(0, 80)} catalysts=${(r.catalysts ?? []).slice(0, 2).join(';')}`
  ).join('\n');

  const synthesisUserMsg = [
    `TEMATICAS (${themes.length}):`,
    themeSummaries,
    '',
    `TOP RECOMENDACIONES (${allRecs.slice(0, 8).length}):`,
    topSymbols,
    '',
    portfolioContext,
    '',
    `HEADLINES: ${dbHeadlines.slice(0, 5).join(' | ')}`,
  ].join('\n');

  let macroContext = themeSummaries;
  let portfolioImpact = '';
  let scenarios: MarketReport['scenarios'] = [];
  let avoidList: string[] = [];
  let actualEngine = 'pipeline-thematic';

  try {
    const { content: rawSynthesis, model: synthModel } = await callAIWithModel('reasoning', synthesisUserMsg, REPORT_SYNTHESIS_PROMPT, 3000);
    actualEngine = synthModel;
    const parsedSynthesis = JSON.parse(rawSynthesis);
    macroContext = parsedSynthesis.macroContext ?? themeSummaries;
    portfolioImpact = parsedSynthesis.portfolioImpact ?? '';
    scenarios = Array.isArray(parsedSynthesis.scenarios)
      ? parsedSynthesis.scenarios.map((s: any) => ({
          name: s.name ?? '',
          probability: s.probability ?? 0,
          distribution: Array.isArray(s.distribution)
            ? s.distribution.map((d: any) => ({
                symbol: d.symbol ?? '',
                weight: d.weight ?? 0,
                reason: d.reason ?? '',
              }))
            : [],
        }))
      : [];
    avoidList = Array.isArray(parsedSynthesis.avoidList) ? parsedSynthesis.avoidList : [];
  } catch (err) {
    console.warn('[MarketReport] Synthesis failed, usando theme summaries como fallback:', (err as Error).message?.slice(0, 80));
  }

  // Construir reporte final
  const topRecs = allRecs.slice(0, 8);
  const alternatives = allRecs.slice(8).map((r, i) => ({
    tier: (i < 3 ? 'A' : 'B') as 'A' | 'B',
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    thesis: r.thesis,
  }));

  const report: MarketReport = {
    generatedAt: Date.now(),
    macroContext,
    portfolioImpact,
    themes,
    topRecommendations: topRecs,
    alternatives,
    scenarios: normalizeScenarios(scenarios),
    avoidList,
    engine: actualEngine,
  };

  // Auto-register discovered tickers (from themes recommendations)
  try {
    const reportSymbols = [...new Set(allRecs.map(r => r.symbol).filter(Boolean))];
    const novelSymbols = reportSymbols.filter(s => !symbols.includes(s));
    if (novelSymbols.length > 0) {
      const registered = await registerNovelTickers(novelSymbols, 'llm');
      console.log(`[MarketReport] ${registered} tickers registrados`);
    }
  } catch { /* non-critical */ }

  // Persist report to DB (replaces in-memory cachedReport)
  const savedReport = saveMarketReport({
    status: report.status ?? 'ok',
    macroContext: report.macroContext,
    portfolioImpact: report.portfolioImpact,
    themes: report.themes,
    topRecommendations: report.topRecommendations,
    alternatives: report.alternatives,
    scenarios: report.scenarios,
    avoidList: report.avoidList,
    engine: report.engine,
    errors: report.errors ?? [],
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[MarketReport] Pipeline completo en ${elapsed}s: ${report.topRecommendations.length} recs, ${report.alternatives.length} alts, ${report.scenarios.length} scenarios, ${themes.length} tematicas (report id: ${savedReport.id})`);

  return report;
}
