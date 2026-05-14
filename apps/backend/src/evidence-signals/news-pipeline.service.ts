import { getAllSymbols } from '../db/repository.js';
import { refreshNewsProcess } from '../opportunities/opportunities.service.js';
import { runSectorIntelligence } from '../intelligence/sector-report.service.js';
import { getEvidenceSignalForSymbol } from './evidence-signals.service.js';
import { analyzeSignalWithContext } from './deep-analysis.service.js';
import type { SectorReport } from '@trading/shared';
import type { EvidenceSignal, EvidenceDeepAnalysis } from '@trading/shared';
import { getAllCachedAnalyses } from './deep-analysis.service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type StageStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

interface StageProgress {
  status: StageStatus;
  detail: string;
  count?: number;
  total?: number;
}

type StageName = 'newsRefresh' | 'sectorAnalysis' | 'symbolDiscovery' | 'evidenceSignals' | 'deepAnalysis' | 'digest';

export interface NewsPipelineStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  currentStage: StageName | null;
  stages: Record<StageName, StageProgress>;
  discoveredSymbols: string[];
  errorMessage: string | null;
}

export interface NewsPipelineResults {
  triggeredAt: string | null;
  sectorReports: SectorReport[];
  discoveredSymbols: string[];
  signals: EvidenceSignal[];
  analyses: EvidenceDeepAnalysis[];
  digest: {
    buySetups: Array<{ symbol: string; sector: string; conviction: string; confidence: number; reasoning: string }>;
    sectorImpactSummary: Array<{ sector: string; impact: string; catalysts: string[] }>;
    warnings: string[];
  } | null;
}

// ─── Module state ─────────────────────────────────────────────────────────────

const STAGE_NAMES: StageName[] = ['newsRefresh', 'sectorAnalysis', 'symbolDiscovery', 'evidenceSignals', 'deepAnalysis', 'digest'];

function makeInitialStages(): Record<StageName, StageProgress> {
  return Object.fromEntries(
    STAGE_NAMES.map((name) => [name, { status: 'pending' as StageStatus, detail: '' }]),
  ) as Record<StageName, StageProgress>;
}

let pipelineStatus: NewsPipelineStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  currentStage: null,
  stages: makeInitialStages(),
  discoveredSymbols: [],
  errorMessage: null,
};

let pipelineResults: NewsPipelineResults = {
  triggeredAt: null,
  sectorReports: [],
  discoveredSymbols: [],
  signals: [],
  analyses: [],
  digest: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStage(name: StageName, update: Partial<StageProgress>): void {
  pipelineStatus.currentStage = name;
  pipelineStatus.stages[name] = { ...pipelineStatus.stages[name], ...update };
}

function portfolioSymbols(): string[] {
  return getAllSymbols()
    .filter((s) => s.type === 'us' || s.type === 'adr')
    .map((s) => s.symbol);
}

function discoverSymbols(reports: SectorReport[]): string[] {
  const fromReports = reports
    .filter((r) => r.conviccion === 'alta' || r.conviccion === 'media')
    .flatMap((r) => r.suggestedTickers);
  const fromPortfolio = portfolioSymbols();
  return [...new Set([...fromReports, ...fromPortfolio])];
}

function findSectorForSymbol(symbol: string, reports: SectorReport[]): SectorReport | null {
  return reports.find((r) => r.suggestedTickers.includes(symbol)) ?? null;
}

function buildDigest(
  sectorReports: SectorReport[],
  signals: EvidenceSignal[],
  analyses: EvidenceDeepAnalysis[],
): NewsPipelineResults['digest'] {
  const analysisMap = new Map(analyses.map((a) => [a.symbol, a]));

  const buySetups = signals
    .filter((s) => analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP')
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .map((s) => {
      const analysis = analysisMap.get(s.symbol)!;
      const sector = findSectorForSymbol(s.symbol, sectorReports);
      return {
        symbol: s.symbol,
        sector: sector?.sector ?? 'N/A',
        conviction: s.conviction,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
      };
    });

  const sectorImpactSummary = sectorReports.map((r) => ({
    sector: r.sector,
    impact: r.impact,
    catalysts: r.catalysts,
  }));

  const warnings: string[] = [];
  const negativeImpactSectors = sectorReports.filter((r) => r.impact === 'negative').map((r) => r.sector);
  if (negativeImpactSectors.length > 0) {
    warnings.push(`Sectores con impacto negativo: ${negativeImpactSectors.join(', ')}`);
  }
  const bearSignals = signals.filter((s) => s.conviction === 'none');
  if (bearSignals.length > signals.length * 0.7) {
    warnings.push('Mayoría de símbolos descubiertos sin señales técnicas confirmadas — considerar cautela');
  }

  return { buySetups, sectorImpactSummary, warnings };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

const SIGNAL_CONCURRENCY = 5;
const ANALYSIS_CONCURRENCY = 3;

async function runNewsPipeline(): Promise<void> {
  if (pipelineStatus.state === 'running') {
    console.warn('[NewsPipeline] Ya en ejecución, ignorando trigger');
    return;
  }

  const startedAt = new Date().toISOString();
  pipelineStatus = {
    state: 'running',
    startedAt,
    finishedAt: null,
    currentStage: null,
    stages: makeInitialStages(),
    discoveredSymbols: [],
    errorMessage: null,
  };
  pipelineResults = { triggeredAt: startedAt, sectorReports: [], discoveredSymbols: [], signals: [], analyses: [], digest: null };

  try {
    // ── Stage 1: News Refresh ────────────────────────────────────────────────
    setStage('newsRefresh', { status: 'running', detail: 'Obteniendo noticias de todas las fuentes...' });
    console.log('[NewsPipeline] Stage 1: refreshing news...');
    let newsCount = 0;
    try {
      const result = await refreshNewsProcess();
      newsCount = result.newsCount;
      setStage('newsRefresh', { status: 'ok', detail: `${newsCount} noticias procesadas y trianguladas` });
      console.log(`[NewsPipeline] Stage 1 OK: ${newsCount} noticias`);
    } catch (err) {
      setStage('newsRefresh', { status: 'failed', detail: `Error: ${(err as Error).message?.slice(0, 100)}` });
      console.warn('[NewsPipeline] Stage 1 falló, continuando con noticias en DB...');
    }

    // ── Stage 2 (triangulation is inside Stage 1 via refreshNewsProcess) ────

    // ── Stage 3: Sector Impact Analysis ─────────────────────────────────────
    setStage('sectorAnalysis', { status: 'running', detail: 'Analizando impacto sectorial de noticias...' });
    console.log('[NewsPipeline] Stage 3: sector analysis...');
    let sectorReports: SectorReport[] = [];
    try {
      const result = await runSectorIntelligence();
      sectorReports = result.reports;
      pipelineResults.sectorReports = sectorReports;
      if (sectorReports.length > 0) {
        setStage('sectorAnalysis', { status: 'ok', detail: `${sectorReports.length} sectores analizados (${result.articleCount} artículos)` });
        console.log(`[NewsPipeline] Stage 3 OK: ${sectorReports.length} sector reports`);
      } else {
        setStage('sectorAnalysis', { status: 'skipped', detail: 'Sin artículos triangulados disponibles' });
        console.warn('[NewsPipeline] Stage 3: sin artículos — sector reports vacíos');
      }
    } catch (err) {
      setStage('sectorAnalysis', { status: 'failed', detail: `Error: ${(err as Error).message?.slice(0, 100)}` });
      console.warn('[NewsPipeline] Stage 3 falló:', (err as Error).message?.slice(0, 100));
    }

    // ── Stage 4: Symbol Discovery ────────────────────────────────────────────
    setStage('symbolDiscovery', { status: 'running', detail: 'Descubriendo símbolos por sector...' });
    const discovered = discoverSymbols(sectorReports);
    pipelineStatus.discoveredSymbols = discovered;
    pipelineResults.discoveredSymbols = discovered;
    setStage('symbolDiscovery', {
      status: 'ok',
      detail: `${discovered.length} símbolos: ${discovered.slice(0, 8).join(', ')}${discovered.length > 8 ? '...' : ''}`,
      count: discovered.length,
      total: discovered.length,
    });
    console.log(`[NewsPipeline] Stage 4: discovered symbols: [${discovered.join(', ')}]`);

    // ── Stage 5: Evidence Signals ────────────────────────────────────────────
    setStage('evidenceSignals', { status: 'running', detail: `Computando señales para ${discovered.length} símbolos...`, count: 0, total: discovered.length });
    console.log(`[NewsPipeline] Stage 5: computing evidence signals for ${discovered.length} symbols...`);

    const signals: EvidenceSignal[] = [];
    let scanned = 0;

    for (let i = 0; i < discovered.length; i += SIGNAL_CONCURRENCY) {
      const batch = discovered.slice(i, i + SIGNAL_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((s) => getEvidenceSignalForSymbol(s)));
      for (const r of results) {
        scanned++;
        if (r.status === 'fulfilled') signals.push(r.value);
        else console.warn(`[NewsPipeline] Signal error:`, (r.reason as Error)?.message?.slice(0, 80));
      }
      setStage('evidenceSignals', { status: 'running', detail: `${scanned}/${discovered.length} símbolos escaneados`, count: scanned, total: discovered.length });
    }

    pipelineResults.signals = signals.sort((a, b) => b.compositeScore - a.compositeScore);
    setStage('evidenceSignals', { status: 'ok', detail: `${signals.length} señales computadas`, count: signals.length, total: discovered.length });
    console.log(`[NewsPipeline] Stage 5 OK: ${signals.length} signals`);

    // ── Stage 6: Deep Analysis with sector context ───────────────────────────
    const candidates = signals.filter((s) => s.conviction === 'high' || s.conviction === 'medium');
    setStage('deepAnalysis', { status: 'running', detail: `Analizando ${candidates.length} señales HIGH/MEDIUM con IA...`, count: 0, total: candidates.length });
    console.log(`[NewsPipeline] Stage 6: deep analysis for ${candidates.length} candidates...`);

    let analyzed = 0;
    for (let i = 0; i < candidates.length; i += ANALYSIS_CONCURRENCY) {
      const batch = candidates.slice(i, i + ANALYSIS_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (signal) => {
          try {
            const sectorContext = findSectorForSymbol(signal.symbol, sectorReports);
            await analyzeSignalWithContext(signal, sectorContext);
          } catch (err) {
            console.warn(`[NewsPipeline] Analysis error ${signal.symbol}:`, (err as Error)?.message?.slice(0, 80));
          } finally {
            analyzed++;
            setStage('deepAnalysis', {
              status: 'running',
              detail: `${analyzed}/${candidates.length} analizados`,
              count: analyzed,
              total: candidates.length,
            });
          }
        }),
      );
    }

    const analyses = getAllCachedAnalyses().filter((a) =>
      signals.some((s) => s.symbol === a.symbol),
    );
    pipelineResults.analyses = analyses;
    setStage('deepAnalysis', { status: 'ok', detail: `${analyses.length} análisis completados`, count: analyses.length, total: candidates.length });
    console.log(`[NewsPipeline] Stage 6 OK: ${analyses.length} analyses`);

    // ── Stage 7: Digest ──────────────────────────────────────────────────────
    setStage('digest', { status: 'running', detail: 'Construyendo digest final...' });
    const digest = buildDigest(sectorReports, signals, analyses);
    pipelineResults.digest = digest;
    const buySetupCount = digest?.buySetups.length ?? 0;
    setStage('digest', { status: 'ok', detail: `${buySetupCount} BUY_SETUP, ${sectorReports.length} sectores` });
    console.log(`[NewsPipeline] Stage 7 OK: ${buySetupCount} buy setups`);

    pipelineStatus.state = 'done';
    pipelineStatus.finishedAt = new Date().toISOString();
    pipelineStatus.currentStage = null;
    console.log(`[NewsPipeline] Pipeline completo — ${buySetupCount} BUY_SETUP encontrados`);
  } catch (err) {
    const msg = (err as Error).message ?? 'Error desconocido';
    pipelineStatus.state = 'failed';
    pipelineStatus.finishedAt = new Date().toISOString();
    pipelineStatus.errorMessage = msg;
    if (pipelineStatus.currentStage) {
      setStage(pipelineStatus.currentStage, { status: 'failed', detail: msg.slice(0, 120) });
    }
    console.error('[NewsPipeline] Error fatal:', err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function triggerNewsPipeline(): void {
  runNewsPipeline().catch((err) => console.error('[NewsPipeline] Error fatal no capturado:', err));
}

export function getNewsPipelineStatus(): NewsPipelineStatus {
  return pipelineStatus;
}

export function getNewsPipelineResults(): NewsPipelineResults {
  return pipelineResults;
}
