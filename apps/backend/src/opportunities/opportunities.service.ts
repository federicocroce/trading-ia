import type {
  Opportunity,
  OpportunityScanResult,
  OpportunitySector,
  AnalysisEngine,
  SectorSummary,
  TechnicalSummary,
  FundamentalSummary,
  SentimentType,
  SymbolTrend,
  MarketPlaza,
  SecondOrderEffect,
} from '@trading/shared';
import {
  OPPORTUNITY_ENRICHMENT_PROMPT,
  OPPORTUNITY_UNIVERSE,
  ALL_OPPORTUNITY_SYMBOLS,
  getSectorForSymbol,
  getSymbolsForSectors,
} from '@trading/shared';
import { askLMStudio } from '../shared/lmstudio.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { getFundamentalSummary } from '../fundamental/fundamental-analysis.service.js';
import { getIntelligence } from '../news/news-intelligence.service.js';
import { analyzeSecondOrderEffects } from '../analysis/sector-correlation.service.js';
import {
  getActiveSymbolList,
  getPortfolioPositions,
  insertOpportunityScan,
  insertOpportunitySnapshots,
  getLatestOpportunityScan,
  getOpportunityScans,
  getOpportunityScanById,
  getSymbolHistory,
} from '../db/repository.js';
import {
  buildAlgorithmicOpportunity,
  filterSymbolsByPositiveSectors,
  applyAntiHypeFilters,
  type SentimentInput,
  type AntiHypeFilterResult,
} from './scoring.js';

// --- In-memory cache (survives within same process, backed by DB) ---
let cachedResult: OpportunityScanResult | null = null;

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function tryLoadFromDB(): OpportunityScanResult | null {
  const latest = getLatestOpportunityScan();
  if (!latest) return null;

  const scanDate = latest.scannedAt.slice(0, 10);
  if (scanDate !== todayDateStr()) return null;

  try {
    const result: OpportunityScanResult = {
      scannedAt: new Date(latest.scannedAt).getTime(),
      totalSymbolsScanned: latest.totalSymbolsScanned,
      opportunities: JSON.parse(latest.opportunities) as Opportunity[],
      sectorSummary: JSON.parse(latest.sectorSummary) as SectorSummary[],
      analysisEngine: latest.engine as AnalysisEngine,
      analysisDetail: latest.engineDetail,
      source: 'db',
    };
    console.log(`[opportunities] Loaded scan from DB (${latest.scannedAt}, engine: ${latest.engine})`);
    return result;
  } catch {
    return null;
  }
}

// --- Batching ---

async function batchProcess<T>(
  symbols: string[],
  processor: (symbol: string) => Promise<T>,
  batchSize: number = 8,
  delayMs: number = 500,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (s) => ({ symbol: s, data: await processor(s) })),
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.set(r.value.symbol, r.value.data);
      } else {
        console.warn(`[opportunities] Failed to process symbol in batch:`, r.reason);
      }
    }

    if (i + batchSize < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// --- LLM Enrichment (Fase 3) ---

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text;
}

interface Enrichment {
  reasoning: string;
  catalysts: string[];
  risks: string[];
}

function buildEnrichmentMessage(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): string {
  const lines: string[] = [];

  for (const opp of opportunities) {
    const tech = techMap.get(opp.symbol);
    const fund = fundMap.get(opp.symbol);
    const sent = sentimentMap.get(opp.symbol);
    const sector = getSectorForSymbol(opp.symbol);
    const sectorLabel = sector ? OPPORTUNITY_UNIVERSE[sector].label : 'Otros';

    lines.push(`=== ${opp.symbol} (${sectorLabel}) — Score: ${opp.opportunityScore}/100, Action: ${opp.action} ===`);

    if (tech?.indicators.rsi14 != null) {
      lines.push(`  Tecnico: RSI=${tech.indicators.rsi14.toFixed(0)}, score=${tech.score} (${tech.signal})`);
    }
    if (fund) {
      const pe = fund.data.peRatio;
      const fpe = fund.data.forwardPE;
      lines.push(`  Fundamental: ${pe != null ? `P/E=${pe.toFixed(1)}` : 'sin P/E'}${fpe != null ? `, Forward=${fpe.toFixed(1)}` : ''}, score=${fund.score} (${fund.signal})`);
    }
    if (sent) {
      lines.push(`  Sentimiento: ${sent.sentiment}, score=${Math.round(sent.score * 100)}, ${sent.headlines.length} noticias`);
      if (sent.headlines.length > 0) {
        lines.push(`  Headlines: ${sent.headlines.slice(0, 2).join(' | ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function enrichWithLLM(
  topOpportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, Enrichment>> {
  const result = new Map<string, Enrichment>();

  try {
    const userMessage = buildEnrichmentMessage(topOpportunities, techMap, fundMap, sentimentMap);
    console.log(`[opportunities] Fase 3: enriqueciendo ${topOpportunities.length} símbolos con LM Studio (${userMessage.length} chars)`);

    const raw = await askLMStudio(userMessage, OPPORTUNITY_ENRICHMENT_PROMPT, 4096);
    const jsonStr = extractJSON(raw);
    const parsed = JSON.parse(jsonStr);

    if (parsed.enrichments && Array.isArray(parsed.enrichments)) {
      for (const e of parsed.enrichments) {
        if (e.symbol && e.reasoning) {
          result.set(e.symbol, {
            reasoning: e.reasoning,
            catalysts: e.catalysts ?? [],
            risks: e.risks ?? [],
          });
        }
      }
    }

    console.log(`[opportunities] LM Studio enriqueció ${result.size}/${topOpportunities.length} símbolos`);
  } catch (err) {
    console.warn(`[opportunities] LM Studio enrichment failed: ${(err as Error).message.slice(0, 150)}`);
    console.warn(`[opportunities] Usando reasoning algoritmico para todos los símbolos`);
  }

  return result;
}

// --- Main pipeline ---

const TOP_N_FOR_LLM = 10;

export async function scanOpportunities(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
  if (cachedResult) {
    return cachedResult;
  }

  const fromDB = tryLoadFromDB();
  if (fromDB) {
    cachedResult = fromDB;
    return cachedResult;
  }

  return runLiveScan(sectors);
}

async function runLiveScan(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
  const allSymbols = sectors && sectors.length > 0
    ? getSymbolsForSectors(sectors)
    : ALL_OPPORTUNITY_SYMBOLS;

  console.log(`[opportunities] Scanning ${allSymbols.length} symbols...`);

  // Fetch data en paralelo
  const [techMap, fundMap, intelligence] = await Promise.all([
    batchProcess(allSymbols, getTechnicalSummary),
    batchProcess(allSymbols, getFundamentalSummary),
    getIntelligence(),
  ]);

  // Extract sentiment from intelligence plazas
  const sentimentMap = new Map<string, SentimentInput>();
  for (const plaza of intelligence.plazas) {
    for (const trend of plaza.symbolTrends as SymbolTrend[]) {
      sentimentMap.set(trend.symbol, {
        score: trend.sentimentScore,
        sentiment: trend.sentiment,
        headlines: trend.topHeadlines,
      });
    }
  }

  // Portfolio
  const positions = getPortfolioPositions();
  const positionMap = new Map(positions.map((p) => [p.symbol, p.quantity]));
  const activeSymbols = new Set(getActiveSymbolList());

  // ============================================================
  // FASE 1: Filtro por sector (funnel)
  // ============================================================
  const plazaSentiments = new Map<MarketPlaza, SentimentType>();
  for (const plaza of intelligence.plazas) {
    plazaSentiments.set(plaza.plaza as MarketPlaza, plaza.overallSentiment as SentimentType);
  }

  const filteredSymbols = filterSymbolsByPositiveSectors(allSymbols, plazaSentiments, activeSymbols);

  const negativeSectors = [...plazaSentiments.entries()]
    .filter(([, s]) => s === 'negative')
    .map(([p]) => p);

  console.log(
    `[opportunities] Fase 1: ${filteredSymbols.length}/${allSymbols.length} símbolos pasan el filtro de sector` +
    (negativeSectors.length > 0 ? ` (sectores negativos: ${negativeSectors.join(', ')})` : ' (ningún sector negativo)'),
  );

  // ============================================================
  // FASE 2: Scoring algorítmico
  // ============================================================
  const opportunities: Opportunity[] = filteredSymbols
    .map((symbol) =>
      buildAlgorithmicOpportunity(
        symbol,
        techMap.get(symbol),
        fundMap.get(symbol),
        sentimentMap.get(symbol),
        activeSymbols.has(symbol),
        positionMap.get(symbol),
      ),
    )
    .filter((o): o is Opportunity => o !== null)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  console.log(`[opportunities] Fase 2: scoring algorítmico completado — ${opportunities.length} oportunidades`);

  // ============================================================
  // FASE 2.5: Filtros anti-hype (SMA200, RSI 40-65, Vol > 150%)
  // ============================================================
  const antiHypeResult = applyAntiHypeFilters(
    opportunities.map((o) => o.symbol),
    techMap,
    activeSymbols,
  );

  const antiHypeSet = new Set(antiHypeResult.filtered);
  for (const opp of opportunities) {
    opp.passedAntiHype = antiHypeSet.has(opp.symbol);
  }

  console.log(
    `[opportunities] Fase 2.5: ${antiHypeResult.passedAll}/${antiHypeResult.totalCandidates} pasan filtros anti-hype` +
    (antiHypeResult.rejected.length > 0
      ? ` (rechazados: ${antiHypeResult.rejected.map((r) => r.symbol).join(', ')})`
      : ''),
  );

  // ============================================================
  // FASE 3: Enriquecimiento LLM (solo top N que pasaron anti-hype)
  // ============================================================
  const topForLLM = opportunities
    .filter((o) => o.passedAntiHype !== false) // only anti-hype approved for LLM
    .slice(0, TOP_N_FOR_LLM);
  let engineDetail = 'Hibrido (algoritmico)';
  let usedEngine: AnalysisEngine = 'hybrid';

  if (topForLLM.length > 0) {
    const enrichments = await enrichWithLLM(topForLLM, techMap, fundMap, sentimentMap);

    if (enrichments.size > 0) {
      for (const opp of opportunities) {
        const enrichment = enrichments.get(opp.symbol);
        if (enrichment) {
          opp.reasoning = enrichment.reasoning;
          if (enrichment.catalysts.length > 0) opp.catalysts = enrichment.catalysts.slice(0, 3);
          if (enrichment.risks.length > 0) opp.risks = enrichment.risks.slice(0, 2);
        }
      }
      engineDetail = `Hibrido — scoring algoritmico + LM Studio (${process.env.LMSTUDIO_MODEL ?? 'local-model'}) para reasoning`;
    } else {
      engineDetail = 'Hibrido (algoritmico, LM Studio no disponible)';
    }
  }

  console.log(`[opportunities] Analysis engine: ${engineDetail}`);

  cachedResult = {
    scannedAt: Date.now(),
    totalSymbolsScanned: allSymbols.length,
    opportunities,
    sectorSummary: buildSectorSummary(allSymbols, opportunities),
    analysisEngine: usedEngine,
    analysisDetail: engineDetail,
    source: 'live',
  };

  persistScanResult(cachedResult);
  return cachedResult;
}

// --- Sector summary ---

function buildSectorSummary(
  symbols: string[],
  opportunities: Opportunity[],
): SectorSummary[] {
  const sectors = new Set<OpportunitySector>();
  for (const s of symbols) {
    const sector = getSectorForSymbol(s);
    if (sector) sectors.add(sector);
  }

  return Array.from(sectors).map((sector) => {
    const sectorOpps = opportunities.filter((o) => o.sector === sector);
    const avgScore = sectorOpps.length > 0
      ? Math.round(sectorOpps.reduce((sum, o) => sum + o.opportunityScore, 0) / sectorOpps.length)
      : 0;
    const top = sectorOpps.length > 0 ? sectorOpps[0].symbol : null;
    const buyCount = sectorOpps.filter((o) => o.action === 'BUY').length;

    return {
      sector,
      label: OPPORTUNITY_UNIVERSE[sector].label,
      symbolCount: OPPORTUNITY_UNIVERSE[sector].symbols.filter((s) => symbols.includes(s)).length,
      avgScore,
      topOpportunity: top,
      sectorOutlook: `${buyCount} de ${sectorOpps.length} activos recomendados para compra`,
    };
  });
}

// --- Persistence ---

function persistScanResult(result: OpportunityScanResult): void {
  try {
    const scannedAtISO = new Date(result.scannedAt).toISOString();

    const scanRow = insertOpportunityScan({
      scannedAt: scannedAtISO,
      engine: result.analysisEngine,
      engineDetail: result.analysisDetail,
      totalSymbolsScanned: result.totalSymbolsScanned,
      opportunityCount: result.opportunities.length,
      opportunities: JSON.stringify(result.opportunities),
      sectorSummary: JSON.stringify(result.sectorSummary),
    });

    const scanId = Number(scanRow.lastInsertRowid);

    const snapshots = result.opportunities.map((o) => ({
      scanId,
      symbol: o.symbol,
      sector: o.sector,
      opportunityScore: o.opportunityScore,
      recommendation: o.action,
      currentPrice: o.currentPrice,
      shortTermMid: o.shortTerm.midPercent,
      mediumTermMid: o.mediumTerm.midPercent,
      confidence: o.confidence,
      reasoning: o.reasoning,
      data: JSON.stringify(o),
      scannedAt: scannedAtISO,
    }));

    insertOpportunitySnapshots(snapshots);
    console.log(`[opportunities] Persisted scan #${scanId}: ${snapshots.length} snapshots`);
  } catch (err) {
    console.error('[opportunities] Failed to persist scan result:', (err as Error).message);
  }
}

// --- History queries ---

export function getOpportunityScanHistory(limit: number = 20) {
  return getOpportunityScans(limit);
}

export function getOpportunityScanDetail(scanId: number) {
  const scan = getOpportunityScanById(scanId);
  if (!scan) return null;
  return {
    ...scan,
    opportunities: JSON.parse(scan.opportunities) as Opportunity[],
    sectorSummary: JSON.parse(scan.sectorSummary) as SectorSummary[],
  };
}

export function getSymbolScoreHistory(symbol: string, limit: number = 30) {
  return getSymbolHistory(symbol, limit);
}

export async function refreshOpportunities(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
  cachedResult = null;
  return runLiveScan(sectors);
}
