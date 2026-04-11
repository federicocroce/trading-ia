import type { MarketReport, MarketReportRecommendation, FundamentalData } from '@trading/shared';
import { MARKET_REPORT_PROMPT } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { getNewsArticlesSince } from '../db/repository.js';
import { getPortfolioPositions, getActiveSymbolList } from '../db/repository.js';
import { getQuotes, getFundamentals } from '../shared/yahoo.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
import { classifyAsset } from '../discovery/asset-classifier.js';

let cachedReport: MarketReport | null = null;

export function getCachedMarketReport(): MarketReport | null {
  return cachedReport;
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

async function fetchThematicNews(): Promise<Array<{ theme: string; headlines: string[] }>> {
  console.log('[MarketReport] Pasada 0: Buscando noticias por temática...');
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
  console.log(`[MarketReport] Pasada 0: ${total} noticias en ${results.length} tematicas`);
  return results;
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

  // Thematic news (new searches)
  for (const { theme, headlines } of thematicNews) {
    if (headlines.length > 0) {
      allContext.push(`\nTEMA "${theme}":`);
      allContext.push(...headlines.map(h => `- ${h}`));
    }
  }

  const prompt = `Sos un analista de mercado. Te doy noticias agrupadas por tematica. Tu trabajo:

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
- CEDEARs disponibles en Argentina: LMT, RTX, NOC, NVDA, TSM, AAPL, MSFT, GOOGL, AMZN, META, TSLA, XOM, CVX, MELI, NU, BABA, CRWD, PLTR, INTC, AMD, NFLX, DIS, KO, PG, JNJ, PFE, BA, GE, CAT, GOLD, NEM, etc.

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

  const prompt = `Sos un analista de inversiones senior. Analiza esta TEMATICA ESPECIFICA para un swing trader argentino.

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

  for (let i = 0; i < tickers.length; i += 5) {
    const batch = tickers.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(async (symbol) => {
      const fund = await getFundamentals(symbol);
      const classification = await classifyAsset(symbol);
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
// MAIN ENTRY POINT
// ============================================================

export async function generateMarketReport(): Promise<MarketReport> {
  console.log('[MarketReport] Starting thematic pipeline...');
  const startTime = Date.now();

  // Gather existing news from DB
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const newsRows = getNewsArticlesSince(since);
  const dbHeadlines = newsRows.map(n => `- ${n.title} [${n.sentiment ?? '?'}] (${n.source})`).slice(0, 20);

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

  // === PASADA 0: Búsqueda temática de noticias ===
  const thematicNews = await fetchThematicNews();

  // === PASADA 1: Identificar temáticas activas ===
  const themes = await identifyActiveThemes(dbHeadlines, thematicNews);
  console.log(`[MarketReport] ${themes.length} tematicas identificadas: ${themes.map(t => `${t.theme} (${t.relevance})`).join(', ')}`);

  if (themes.length === 0) {
    throw new Error('No se identificaron temáticas relevantes. Probá de nuevo más tarde.');
  }

  // Collect all suggested tickers from all themes
  const allSuggestedTickers = [...new Set(themes.flatMap(t => t.suggestedTickers))];
  // Add portfolio symbols
  const allTickers = [...new Set([...symbols, ...allSuggestedTickers])];

  // === PASADA 2 (prep): Enriquecer con datos reales ===
  const tickerData = await enrichWithRealData(allTickers);

  // === PASADA 2: Análisis profundo por temática (en paralelo para high/medium) ===
  const activeThemes = themes.filter(t => t.relevance !== 'low');
  console.log(`[MarketReport] Analizando ${activeThemes.length} temáticas en profundidad...`);

  const themeAnalyses: ThemeDeepAnalysis[] = [];
  // Do 2 at a time to not overwhelm Groq rate limits
  for (let i = 0; i < activeThemes.length; i += 2) {
    const batch = activeThemes.slice(i, i + 2);
    const results = await Promise.allSettled(
      batch.map(theme => analyzeThemeDeep(theme, tickerData)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') themeAnalyses.push(r.value);
    }
  }

  // === PASADA 3: Consolidar reporte final ===
  const report = await consolidateFinalReport(themes, themeAnalyses, portfolioContext, dbHeadlines);

  // Auto-register discovered tickers
  try {
    const novelSymbols = allSuggestedTickers.filter(s => !symbols.includes(s));
    if (novelSymbols.length > 0) {
      const registered = await registerNovelTickers(novelSymbols, 'llm');
      console.log(`[MarketReport] ${registered} tickers registrados`);
    }
  } catch { /* non-critical */ }

  cachedReport = report;
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[MarketReport] Pipeline completo en ${elapsed}s: ${report.topRecommendations.length} recs, ${report.alternatives.length} alts, ${report.scenarios.length} scenarios, ${themes.length} tematicas`);

  return report;
}
