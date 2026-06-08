import type { MarketReport, MarketReportRecommendation, TopImpactNewsItem, UnifiedAssetAnalysis, MarketDigest, SecondOrderEffect, SectorSummary, QuantContext, Opportunity } from '@trading/shared';
import { groundWouldBuyItems } from './digest-grounding.js';
import { COMBINED_SYNTHESIS_PROMPT, CANONICAL_MACRO_THEMES } from '@trading/shared';
import { callAIWithModel } from '../shared/ai-router.js';
import {
  getNewsArticlesForToday,
  getAllSymbols,
  type MacroEventRow,
} from '../db/repository.js';
import { getPortfolioPositions, getActiveSymbolList } from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
import {
  getTodayMarketReport,
  getMarketReportByDate,
  saveMarketReport,
} from './pipeline.repository.js';
import { getCurrentBuyTickers, filterItemsVsBuyTickers } from '../opportunities/opportunities.service.js';

function filterAvoidListVsBuy(items: string[], buyTickers: Set<string>): string[] {
  return filterItemsVsBuyTickers(items, buyTickers);
}

function rowToMarketReport(row: NonNullable<ReturnType<typeof getTodayMarketReport>>): MarketReport {
  const rawAvoid = (row.avoidList as unknown[]) ?? [];
  const avoidStrings = rawAvoid
    .map(x => (typeof x === 'string' ? x : (x && typeof x === 'object' ? JSON.stringify(x) : '')))
    .filter(s => s.length > 0);
  return {
    generatedAt: row.generatedAt ? new Date(row.generatedAt).getTime() : Date.now(),
    macroContext: row.macroContext ?? '',
    portfolioImpact: row.portfolioImpact ?? '',
    topImpactNews: (row.topImpactNews as MarketReport['topImpactNews']) ?? undefined,
    themes: (row.themes as MarketReport['themes']) ?? [],
    topRecommendations: (row.topRecommendations as MarketReport['topRecommendations']) ?? [],
    alternatives: (row.alternatives as MarketReport['alternatives']) ?? [],
    scenarios: (row.scenarios as MarketReport['scenarios']) ?? [],
    avoidList: filterItemsVsBuyTickers(avoidStrings, getCurrentBuyTickers()),
    engine: row.engine ?? 'pipeline-thematic',
    status: (row.status as MarketReport['status']) ?? 'ok',
    errors: (row.errors as string[]) ?? [],
  };
}

export function getCachedMarketReport(): MarketReport | null {
  const row = getTodayMarketReport();
  return row ? rowToMarketReport(row) : null;
}

export function getCachedMarketReportByDate(date: string): MarketReport | null {
  const row = getMarketReportByDate(date);
  return row ? rowToMarketReport(row) : null;
}

// ============================================================
// THEME NORMALIZATION
// ============================================================

const THEME_KEYWORDS: Array<[string, string[]]> = [
  ['Semiconductores/IA', ['semiconductor', 'chip', 'nvda', 'ai/', 'inteligencia artificial', 'semiconductores', 'nvidia', 'amd', 'intel']],
  ['Energía/Oil', ['petróleo', 'petroleo', 'oil', 'energía', 'energia', 'opec', 'xom', 'cvx', 'combustible']],
  ['Argentina/CEDEARs', ['argentina', 'cedear', 'merval', 'emergente', 'latam', 'ggal', 'bma', 'vist', 'ypf']],
  ['Cripto', ['crypto', 'cripto', 'bitcoin', 'blockchain', 'ethereum', 'btc', 'eth']],
  ['Defensa/Geopolítica', ['defensa', 'defense', 'geopolít', 'guerra', 'conflicto', 'lmt', 'rtx', 'noc', 'militar']],
  ['Banca US', ['banca', 'bank', 'finanzas', 'finance', 'jpmorgan', 'goldman', 'wells fargo']],
  ['Salud/Biotech', ['farma', 'pharma', 'salud', 'health', 'biotech', 'fda', 'medicamento']],
  ['Commodities', ['commodity', 'commodit', 'oro', 'gold', 'cobre', 'copper', 'litio', 'lithium', 'uranium', 'mineria', 'mining', 'metal']],
  ['Bonos/Tasas', ['bono', 'bonos', 'bond', 'bonds', 'treasury', 'treasuries', 'yield', 'duration', 'tlt', 'hyg', 'agg', 'emb', 'lqd', 'shy', 'ief', 'tip', 'credit spread']],
  ['Política Monetaria', ['política monetaria', 'politica monetaria', 'federal reserve', 'fed ', 'interest rate', 'tasa de interés', 'tasa de interes', 'inflacion', 'inflación', 'banco central']],
  ['Consumo/Retail', ['consumo', 'retail', 'consumer', 'minorista', 'comercio minorista', 'amazon', 'walmart']],
];

function normalizeMacroTheme(theme: string | null): string {
  if (!theme) return 'Otros';
  const t = theme.toLowerCase().trim();
  const exact = CANONICAL_MACRO_THEMES.find(c => c.toLowerCase() === t);
  if (exact) return exact;
  for (const [canonical, keywords] of THEME_KEYWORDS) {
    if (keywords.some(kw => t.includes(kw))) return canonical;
  }
  return theme.trim();
}

// ============================================================
// HELPERS
// ============================================================

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

/**
 * Build a rich theme summary from pre-computed UnifiedAssetAnalysis data.
 * Uses actual thesis/catalysts — no extra LLM call needed.
 */
function buildThemeSummary(recs: MarketReportRecommendation[]): string {
  const topRecs = recs.slice(0, 2);
  if (topRecs.length === 0) return '';
  const parts = topRecs
    .map(r => r.thesis ? r.thesis.slice(0, 100) : r.symbol)
    .filter(Boolean);
  return parts.join(' | ');
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export interface DigestInputs {
  opportunities: Opportunity[];
  secondOrderEffects: SecondOrderEffect[];
  intelligence: { totalNewsCount: number; topHeadlines?: string[]; plazaSummaries?: Array<{ plaza: string; sentiment: string; score: number }> };
  sectorSummary: SectorSummary[];
  quantContext?: QuantContext | null;
  earningsContext?: string;
  causalMap?: MacroEventRow[];
}

function synthesizeBuyLine(o: Opportunity): string {
  const parts: string[] = [`Compraría ${o.symbol}`];
  if (o.tradeLevels) {
    parts.push(`a $${o.tradeLevels.entryPrice.toFixed(2)}`);
  }
  const reason = o.simpleReasoning ?? o.catalysts[0] ?? 'señal técnica positiva';
  parts.push(`— ${reason}`);
  if (o.tradeLevels) {
    parts.push(`Stop $${o.tradeLevels.stopLoss.toFixed(2)}, target $${o.tradeLevels.takeProfit.toFixed(2)}.`);
  }
  return parts.join(' ');
}

function synthesizeSellLine(o: Opportunity): string {
  const reason = o.simpleReasoning ?? o.risks[0] ?? 'señales negativas';
  return `No mantendría ${o.symbol} — ${reason}`;
}

interface WouldArrays {
  portfolioWouldDo: string[];
  portfolioWouldNotDo: string[];
  marketWouldDo: string[];
  marketWouldNotDo: string[];
}

function synthesizeWouldArrays(
  opportunities: Opportunity[],
  portfolioSymbols: Set<string>,
  limit = 5,
): WouldArrays {
  const buys = opportunities.filter(o => o.action === 'BUY');
  const sells = opportunities.filter(o => o.action === 'SELL');
  // Portfolio set is normalized to uppercase; compare uppercased ticker.
  const inPortfolio = (sym: string) => portfolioSymbols.has(sym.toUpperCase());
  return {
    portfolioWouldDo: buys.filter(o => inPortfolio(o.symbol)).slice(0, limit).map(synthesizeBuyLine),
    portfolioWouldNotDo: sells.filter(o => inPortfolio(o.symbol)).slice(0, limit).map(synthesizeSellLine),
    marketWouldDo: buys.filter(o => !inPortfolio(o.symbol)).slice(0, limit).map(synthesizeBuyLine),
    marketWouldNotDo: sells.filter(o => !inPortfolio(o.symbol)).slice(0, limit).map(synthesizeSellLine),
  };
}

function buildFallbackDigest(
  opportunities: Opportunity[],
  effects: SecondOrderEffect[],
  headlines: string[],
  portfolioSymbols: Set<string>,
): MarketDigest {
  const topBuy = opportunities.filter(o => o.action === 'BUY').slice(0, 3);
  const buyCount = opportunities.filter(o => o.action === 'BUY').length;
  const sellCount = opportunities.filter(o => o.action === 'SELL').length;
  const would = synthesizeWouldArrays(opportunities, portfolioSymbols, 3);
  return {
    generatedAt: Date.now(),
    overnightSummary: headlines.length > 0 ? headlines.slice(0, 3).join('. ') + '.' : 'Sin noticias relevantes recientes.',
    portfolioImpact: effects.length > 0 ? effects.slice(0, 2).map(e => e.reasoning).join(' ') : 'Sin efectos de segundo orden identificados.',
    topOpportunities: topBuy.map(o => ({ symbol: o.symbol, action: 'BUY' as const, narrative: o.simpleReasoning ?? o.reasoning })),
    warnings: opportunities.filter(o => o.action === 'SELL').slice(0, 2).map(o => `${o.symbol}: ${o.risks[0] ?? 'señales negativas'}`),
    marketMood: buyCount > sellCount * 2 ? 'risk-on' : sellCount > buyCount ? 'risk-off' : 'mixed',
    ...would,
  };
}

export async function generateMarketReport(
  precomputedAnalyses: Map<string, UnifiedAssetAnalysis>,
  digestInputs?: DigestInputs,
): Promise<{ report: MarketReport; digest: MarketDigest | null }> {
  console.log('[MarketReport] Starting report generation from pre-computed analyses...');
  const startTime = Date.now();

  if (precomputedAnalyses.size === 0) {
    throw new Error('generateMarketReport requires pre-computed UnifiedAssetAnalysis from Stage 3. Run full pipeline first.');
  }

  // Gather portfolio context
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

  // Headlines for synthesis — split into macro vs ticker-specific so the LLM
  // can produce balanced topImpactNews (not just stock earnings news).
  const todayArticles = getNewsArticlesForToday('medium');
  const MACRO_KEYWORDS = /fed|federal reserve|interest rate|rate cut|rate hike|inflation|cpi|pce|recession|gdp|tariff|trade war|sanction|geopolitical|opec|ecb|china|war|conflict|treasury|yield|aranceles|guerra|inflacion|reserva federal/i;
  const macroHeadlines: string[] = [];
  const tickerHeadlines: string[] = [];
  for (const a of todayArticles) {
    const line = `- ${a.title} [${(a as any).sentiment ?? '?'}]`;
    if (MACRO_KEYWORDS.test(a.title)) {
      macroHeadlines.push(line);
    } else {
      tickerHeadlines.push(line);
    }
  }

  // Build symbol metadata from DB
  const allDbSymbols = getAllSymbols();
  const symbolMetaMap = new Map<string, { name: string; instrumentType: string }>();
  for (const s of allDbSymbols) {
    let instrumentType = 'Accion US';
    if (s.plaza === 'argentina-cedears' || s.type === 'adr') instrumentType = 'CEDEAR';
    else if (s.type === 'crypto') instrumentType = 'Crypto';
    else if (s.type === 'bond') instrumentType = 'Bono';
    else if (s.type === 'etf' || s.plaza === 'etfs-sectors') instrumentType = 'ETF';
    else if (s.type === 'commodity' || s.plaza === 'commodities') instrumentType = 'Commodity';
    symbolMetaMap.set(s.symbol, { name: s.name || s.symbol, instrumentType });
  }

  const portfolioSymbolSet = new Set(positions.map(p => p.symbol.toUpperCase()));

  // Group analyses by normalized macroTheme, build recommendations
  const themeMap = new Map<string, MarketReportRecommendation[]>();

  for (const [symbol, analysis] of precomputedAnalyses) {
    // Include all analyses that reached this stage — unified-analysis already
    // filtered to: portfolio + BUY/SELL + HOLD/WATCH-with-news. Showing every
    // analyzed symbol gives the user "we saw this in news but it's not buy time yet".
    const isInPortfolio = portfolioSymbolSet.has(symbol.toUpperCase());

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

  const themes: MarketReport['themes'] = [...themeMap.entries()].map(([theme, recs]) => ({
    theme,
    relevance: (recs.some(r => (r.suggestedWeight ?? 0) >= 10) ? 'high' : 'medium') as 'high' | 'medium' | 'low',
    summary: buildThemeSummary(recs),
    sectors: [],
    recommendations: recs,
  }));

  const allRecs: MarketReportRecommendation[] = [...themeMap.values()].flat()
    .filter(r => (r.suggestedWeight ?? 0) > 0)
    .sort((a, b) => (b.suggestedWeight ?? 0) - (a.suggestedWeight ?? 0));

  console.log(`[MarketReport] ${themes.length} temas, ${allRecs.length} recomendaciones`);

  // Combined synthesis + digest — single LLM call
  const themeSummaries = themes
    .map(t => `[${(t.relevance ?? 'med').toUpperCase()}] ${t.theme}: ${t.summary} (${t.recommendations.length} activos)`)
    .join('\n');

  const topSymbols = allRecs.slice(0, 8).map(r =>
    `${r.symbol}: ${(r.thesis ?? '').slice(0, 80)} catalysts=${(r.catalysts ?? []).slice(0, 2).join(';')}`
  ).join('\n');

  const userMsgParts: string[] = [
    `TEMATICAS (${themes.length}):`,
    themeSummaries,
    '',
    `TOP RECOMENDACIONES (${allRecs.slice(0, 8).length}):`,
    topSymbols,
    '',
    portfolioContext,
    '',
    `HEADLINES MACRO (priorizá estas para topImpactNews):\n${macroHeadlines.slice(0, 10).join('\n') || '(ninguna detectada)'}`,
    '',
    `HEADLINES TICKER-ESPECÍFICAS:\n${tickerHeadlines.slice(0, 10).join('\n') || '(ninguna)'}`,
  ];

  // Enrich with digest-specific context when available
  if (digestInputs) {
    const topBuySell = digestInputs.opportunities.filter(o => o.action === 'BUY' || o.action === 'SELL').slice(0, 5);
    if (topBuySell.length > 0) {
      userMsgParts.push(`\nTOP OPORTUNIDADES ALGORÍTMICAS:\n${topBuySell.map(o => {
        let line = `${o.symbol} (${o.action}): score ${o.opportunityScore}`;
        if (o.tradeLevels) line += ` | Entry $${o.tradeLevels.entryPrice.toFixed(2)}, Stop $${o.tradeLevels.stopLoss.toFixed(2)}, Target $${o.tradeLevels.takeProfit.toFixed(2)}`;
        if (o.signalConflicts?.length) line += ` | CONFLICTOS: ${o.signalConflicts.map(c => `${c.signalA} vs ${c.signalB}`).join(', ')}`;
        return line;
      }).join('\n')}`);
    }

    if (digestInputs.secondOrderEffects.length > 0) {
      userMsgParts.push(`\nEFECTOS DE SEGUNDO ORDEN:\n${digestInputs.secondOrderEffects.map(e =>
        `- ${e.triggerEvent}: ${e.causalChain.join(' → ')} [${e.impactDirection}] (${e.affectedTickers.join(', ')})`
      ).join('\n')}`);
    }

    if (digestInputs.quantContext?.regime && digestInputs.quantContext.regime.regime !== 'unknown') {
      const r = digestInputs.quantContext.regime;
      const regimeLabel: Record<string, string> = { trending_bull: 'Tendencia alcista', trending_bear: 'Tendencia bajista', mean_reverting: 'Mercado lateral', volatile: 'Alta volatilidad' };
      userMsgParts.push(`\nRÉGIMEN DE MERCADO: ${regimeLabel[r.regime] ?? r.regime} (confianza: ${r.confidence}%)`);
    }

    if (digestInputs.earningsContext) {
      userMsgParts.push(`\n${digestInputs.earningsContext}`);
    }

    if (digestInputs.causalMap && digestInputs.causalMap.length > 0) {
      const causalLines = digestInputs.causalMap
        .sort((a, b) => (a.magnitude === 'high' ? -1 : b.magnitude === 'high' ? 1 : 0))
        .slice(0, 8)
        .map(evt => {
          const chainSummary = evt.chains.slice(0, 4)
            .map(c => `${c.ticker}(${c.direction === 'positive' ? '+' : '-'}): ${c.reason.slice(0, 60)}`)
            .join('; ');
          return `[${evt.magnitude.toUpperCase()}] ${evt.event} → ${chainSummary}`;
        });
      userMsgParts.push(`\nEVENTOS MACRO CAUSALES:\n${causalLines.join('\n')}`);
    }
  }

  const combinedUserMsg = userMsgParts.join('\n');

  let macroContext = themeSummaries;
  let portfolioImpact = '';
  let topImpactNews: TopImpactNewsItem[] = [];
  let scenarios: MarketReport['scenarios'] = [];
  let avoidList: string[] = [];
  let actualEngine = 'pipeline-thematic';
  let digest: MarketDigest | null = null;

  try {
    const { content: rawSynthesis, model: synthModel } = await callAIWithModel('reasoning', combinedUserMsg, COMBINED_SYNTHESIS_PROMPT, 8192);
    actualEngine = synthModel ?? actualEngine;
    const p = JSON.parse(rawSynthesis);

    macroContext = p.macroContext ?? themeSummaries;
    portfolioImpact = p.portfolioImpact ?? '';
    topImpactNews = Array.isArray(p.topImpactNews)
      ? p.topImpactNews.slice(0, 10).map((n: any) => ({
          headline: n.headline ?? '',
          sectors: Array.isArray(n.sectors)
            ? n.sectors.map((s: any) => ({ name: s.name ?? '', direction: ['positive', 'negative', 'neutral'].includes(s.direction) ? s.direction : 'neutral' }))
            : [],
          confidence: ['high', 'medium', 'low'].includes(n.confidence) ? n.confidence : 'medium',
          tickers: Array.isArray(n.tickers) ? n.tickers : [],
        }))
      : [];
    scenarios = Array.isArray(p.scenarios)
      ? p.scenarios.map((s: any) => ({
          name: s.name ?? '',
          probability: s.probability ?? 0,
          distribution: Array.isArray(s.distribution)
            ? s.distribution.map((d: any) => ({ symbol: d.symbol ?? '', weight: d.weight ?? 0, reason: d.reason ?? '' }))
            : [],
        }))
      : [];
    // Build digest from same response
    const buyTickers = new Set(
      (digestInputs?.opportunities ?? [])
        .filter(o => o.action === 'BUY')
        .map(o => o.symbol.toUpperCase())
    );
    avoidList = filterAvoidListVsBuy(Array.isArray(p.avoidList) ? p.avoidList : [], buyTickers);
    const coerceToString = (item: unknown): string => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        // LLM sometimes returns {ticker, razon} or {symbol, reason} instead of plain strings
        const obj = item as Record<string, unknown>;
        const ticker = String(obj.ticker ?? obj.symbol ?? '').trim();
        const reason = String(obj.razon ?? obj.reason ?? obj.razonamiento ?? '').trim();
        if (ticker && reason) return `No operaría ${ticker} — ${reason}`;
        if (reason) return reason;
        if (ticker) return ticker; // bare ticker — will get dropped by word-count filter below
      }
      return '';
    };
    const sanitizeWouldNotDo = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map(coerceToString)
        .filter(Boolean)
        .filter(item => {
          // Drop bare-ticker entries (e.g. "VIST", "- YPF"): require >= 4 words
          const wordCount = item.replace(/[-•*]/g, '').trim().split(/\s+/).filter(Boolean).length;
          if (wordCount < 4) return false;
          // Drop only when the PRIMARY ticker (first uppercase token after the verb) is a BUY ticker.
          // Mentions of BUY tickers in passing (e.g. "evitar TSLA porque NVDA absorbe el flujo") are OK.
          const stripped = item.replace(/[-•*]/g, '').trim();
          const firstTokenMatch = stripped.match(/^[^A-Z]*([A-Z][A-Z0-9.-]{0,5})\b/);
          const primary = firstTokenMatch?.[1];
          if (primary && buyTickers.has(primary)) return false;
          return true;
        })
        .slice(0, 8);
    };

    const sanitizeWouldDo = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw
        .map(coerceToString)
        .filter(Boolean)
        .filter(item => {
          const wordCount = item.replace(/[-•*]/g, '').trim().split(/\s+/).filter(Boolean).length;
          return wordCount >= 4;
        })
        .slice(0, 8);
    };

    // Defensive reclassification: the LLM regularly mislabels portfolio vs market
    // despite the prompt. We extract ticker-like tokens from each item and route
    // by ACTUAL portfolio membership, ignoring whatever bucket the LLM picked.
    const classifyByPortfolio = (items: string[]): { portfolio: string[]; market: string[]; unresolved: string[] } => {
      const portfolio: string[] = [];
      const market: string[] = [];
      const unresolved: string[] = [];
      for (const item of items) {
        // Tickers we recognize from this run (portfolio + opportunities universe)
        const knownTickers = new Set<string>([
          ...portfolioSymbolSet,
          ...(digestInputs?.opportunities ?? []).map(o => o.symbol.toUpperCase()),
        ]);
        const tokens = (item.match(/\b[A-Z][A-Z0-9.-]{0,5}\b/g) ?? []).filter(t => knownTickers.has(t));
        if (tokens.length === 0) {
          unresolved.push(item);
          continue;
        }
        const firstPortfolio = tokens.find(t => portfolioSymbolSet.has(t));
        if (firstPortfolio) portfolio.push(item);
        else market.push(item);
      }
      return { portfolio, market, unresolved };
    };

    const opps = digestInputs?.opportunities ?? [];
    const fallback = synthesizeWouldArrays(opps, portfolioSymbolSet, 5);

    const llmPortfolioWouldDo = sanitizeWouldDo(p.portfolioWouldDo);
    const llmPortfolioWouldNotDo = sanitizeWouldNotDo(p.portfolioWouldNotDo);
    const llmMarketWouldDo = sanitizeWouldDo(p.marketWouldDo);
    const llmMarketWouldNotDo = sanitizeWouldNotDo(p.marketWouldNotDo);

    // Merge LLM buckets and reclassify by actual portfolio membership.
    const allLlmWouldDo = [...llmPortfolioWouldDo, ...llmMarketWouldDo];
    const allLlmWouldNotDo = [...llmPortfolioWouldNotDo, ...llmMarketWouldNotDo];
    const doClassified = classifyByPortfolio(allLlmWouldDo);
    const notDoClassified = classifyByPortfolio(allLlmWouldNotDo);

    const misroutedDo = (llmPortfolioWouldDo.length + llmMarketWouldDo.length) > 0
      && (doClassified.portfolio.length !== llmPortfolioWouldDo.length || doClassified.market.length !== llmMarketWouldDo.length);
    const misroutedNotDo = (llmPortfolioWouldNotDo.length + llmMarketWouldNotDo.length) > 0
      && (notDoClassified.portfolio.length !== llmPortfolioWouldNotDo.length || notDoClassified.market.length !== llmMarketWouldNotDo.length);
    if (misroutedDo) {
      console.warn(`[MarketReport] Reclasificación WouldDo: LLM dijo portfolio=${llmPortfolioWouldDo.length}/market=${llmMarketWouldDo.length}, real portfolio=${doClassified.portfolio.length}/market=${doClassified.market.length}/unresolved=${doClassified.unresolved.length}`);
    }
    if (misroutedNotDo) {
      console.warn(`[MarketReport] Reclasificación WouldNotDo: LLM dijo portfolio=${llmPortfolioWouldNotDo.length}/market=${llmMarketWouldNotDo.length}, real portfolio=${notDoClassified.portfolio.length}/market=${notDoClassified.market.length}/unresolved=${notDoClassified.unresolved.length}`);
    }

    // Unresolved items (no recognizable ticker) — bucket by LLM's original label as best-effort.
    // If they came from a portfolio-labeled array → stick portfolio; otherwise market.
    const unresolvedDoFromPortfolio = doClassified.unresolved.filter(it => llmPortfolioWouldDo.includes(it));
    const unresolvedDoFromMarket = doClassified.unresolved.filter(it => llmMarketWouldDo.includes(it));
    const unresolvedNotDoFromPortfolio = notDoClassified.unresolved.filter(it => llmPortfolioWouldNotDo.includes(it));
    const unresolvedNotDoFromMarket = notDoClassified.unresolved.filter(it => llmMarketWouldNotDo.includes(it));

    const reclassifiedPortfolioWouldDo = [...doClassified.portfolio, ...unresolvedDoFromPortfolio].slice(0, 5);
    const reclassifiedMarketWouldDo = [...doClassified.market, ...unresolvedDoFromMarket].slice(0, 5);
    const reclassifiedPortfolioWouldNotDo = [...notDoClassified.portfolio, ...unresolvedNotDoFromPortfolio].slice(0, 5);
    const reclassifiedMarketWouldNotDo = [...notDoClassified.market, ...unresolvedNotDoFromMarket].slice(0, 5);

    const rawPortfolioWouldDo = reclassifiedPortfolioWouldDo.length > 0 ? reclassifiedPortfolioWouldDo : fallback.portfolioWouldDo;
    const finalPortfolioWouldNotDo = reclassifiedPortfolioWouldNotDo.length > 0 ? reclassifiedPortfolioWouldNotDo : fallback.portfolioWouldNotDo;
    const rawMarketWouldDo = reclassifiedMarketWouldDo.length > 0 ? reclassifiedMarketWouldDo : fallback.marketWouldDo;
    const finalMarketWouldNotDo = reclassifiedMarketWouldNotDo.length > 0 ? reclassifiedMarketWouldNotDo : fallback.marketWouldNotDo;

    // Anti-hallucination: ground would-buy bullets against the scan. Market picks must be real
    // BUYs (drops upgraded WATCH like XLE); all numbers are re-rendered from the scan tradeLevels
    // so a fabricated price (e.g. "XLE a $88.50") can never reach the UI.
    const groundingOpps = (digestInputs?.opportunities ?? []).map(o => ({
      symbol: o.symbol, action: o.action, currentPrice: o.currentPrice, tradeLevels: o.tradeLevels,
    }));
    const finalMarketWouldDo = groundWouldBuyItems(rawMarketWouldDo, groundingOpps);
    const finalPortfolioWouldDo = groundWouldBuyItems(rawPortfolioWouldDo, groundingOpps, { dropNonBuy: false });

    if (reclassifiedPortfolioWouldDo.length === 0 && finalPortfolioWouldDo.length > 0) {
      console.log(`[MarketReport] portfolioWouldDo empty post-reclass — fallback ${finalPortfolioWouldDo.length} desde portfolio BUY opps`);
    }
    if (reclassifiedMarketWouldDo.length === 0 && finalMarketWouldDo.length > 0) {
      console.log(`[MarketReport] marketWouldDo empty post-reclass — fallback ${finalMarketWouldDo.length} desde non-portfolio BUY opps`);
    }

    digest = {
      generatedAt: Date.now(),
      overnightSummary: p.overnightSummary ?? '',
      portfolioImpact,
      topOpportunities: Array.isArray(p.topOpportunities)
        ? p.topOpportunities.slice(0, 5).map((o: any) => ({ symbol: o.symbol ?? '', action: o.action ?? 'BUY', narrative: o.narrative ?? '' }))
        : [],
      watching: Array.isArray(p.watching)
        ? p.watching.slice(0, 4).map((o: any) => ({ symbol: o.symbol ?? '', narrative: o.narrative ?? '' })).filter((o: any) => o.symbol)
        : [],
      warnings: Array.isArray(p.warnings) ? p.warnings.slice(0, 3) : [],
      marketMood: ['risk-on', 'risk-off', 'mixed'].includes(p.marketMood) ? p.marketMood : 'mixed',
      portfolioWouldDo: finalPortfolioWouldDo,
      portfolioWouldNotDo: finalPortfolioWouldNotDo,
      marketWouldDo: finalMarketWouldDo,
      marketWouldNotDo: finalMarketWouldNotDo,
    };

    console.log('[MarketReport] Combined synthesis OK — report + digest generados');
  } catch (err) {
    console.warn('[MarketReport] Combined synthesis failed, usando fallback:', (err as Error).message?.slice(0, 80));
    actualEngine = 'pipeline-thematic (fallback)';
    if (digestInputs) {
      const headlines = digestInputs.intelligence.topHeadlines ?? [];
      digest = buildFallbackDigest(digestInputs.opportunities, digestInputs.secondOrderEffects, headlines, portfolioSymbolSet);
    }
  }

  const topRecs = allRecs.slice(0, 8);
  const alternatives = allRecs.slice(8).map(r => ({
    tier: ((r.suggestedWeight ?? 0) >= 8 ? 'A' : 'B') as 'A' | 'B',
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    thesis: r.thesis,
  }));

  const report: MarketReport = {
    generatedAt: Date.now(),
    macroContext,
    portfolioImpact,
    topImpactNews: topImpactNews.length > 0 ? topImpactNews : undefined,
    themes,
    topRecommendations: topRecs,
    alternatives,
    scenarios: normalizeScenarios(scenarios),
    avoidList,
    engine: actualEngine,
  };

  // Auto-register discovered tickers from report recommendations
  try {
    const reportSymbols = [...new Set(allRecs.map(r => r.symbol).filter(Boolean))];
    const novelSymbols = reportSymbols.filter(s => !symbols.includes(s));
    if (novelSymbols.length > 0) {
      const registered = await registerNovelTickers(novelSymbols, 'llm');
      console.log(`[MarketReport] ${registered} tickers registrados`);
    }
  } catch { /* non-critical */ }

  const savedReport = saveMarketReport({
    status: report.status ?? 'ok',
    macroContext: report.macroContext,
    portfolioImpact: report.portfolioImpact,
    topImpactNews: report.topImpactNews,
    themes: report.themes,
    topRecommendations: report.topRecommendations,
    alternatives: report.alternatives,
    scenarios: report.scenarios,
    avoidList: report.avoidList,
    engine: report.engine,
    errors: report.errors ?? [],
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[MarketReport] Completo en ${elapsed}s: ${report.topRecommendations.length} recs, ${themes.length} temas (report id: ${savedReport.id})`);

  return { report, digest };
}
