import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { callAIWithModel } from '../shared/ai-router.js';
import { searchTavily } from '../web-search/tavily.js';
import { getHistoricalQuotes, getFundamentals } from '../shared/yahoo.js';
import { getSectorMomentum } from './sector-momentum.service.js';
import type { FundamentalData } from '@trading/shared';
import type { EvidenceSignal, EvidenceDeepAnalysis } from '@trading/shared';

const ANALYSIS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches signal cache TTL
const CONCURRENCY = 3;

// ─── State ────────────────────────────────────────────────────────────────────

let analysisState: 'idle' | 'analyzing' = 'idle';
let analyzedCount = 0;
let analysisTotal = 0;

export function getAnalysisStatus() {
  return { analysisState, analyzedCount, analysisTotal };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export function getCachedAnalysis(symbol: string): EvidenceDeepAnalysis | null {
  const row = db.select()
    .from(schema.evidenceDeepAnalysis)
    .where(eq(schema.evidenceDeepAnalysis.symbol, symbol))
    .get();

  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  return rowToAnalysis(row);
}

export function getAllCachedAnalyses(): EvidenceDeepAnalysis[] {
  const rows = db.select().from(schema.evidenceDeepAnalysis).all();
  return rows
    .filter((r) => new Date(r.expiresAt) > new Date())
    .map(rowToAnalysis)
    .sort((a, b) => b.confidence - a.confidence);
}

function rowToAnalysis(row: typeof schema.evidenceDeepAnalysis.$inferSelect): EvidenceDeepAnalysis {
  return {
    symbol: row.symbol,
    analysisDate: row.analysisDate,
    verdict: row.verdict as EvidenceDeepAnalysis['verdict'],
    reasoning: row.reasoning,
    entryZone: row.entryZone,
    target: row.target,
    stopLoss: row.stopLoss,
    riskReward: row.riskReward,
    confidence: row.confidence,
    keyRisks: JSON.parse(row.keyRisks) as string[],
    timeframe: row.timeframe,
    model: row.model,
    fetchedAt: row.fetchedAt,
  };
}

function setCachedAnalysis(analysis: EvidenceDeepAnalysis): void {
  const now = new Date();
  const expires = new Date(now.getTime() + ANALYSIS_TTL_MS);
  db.insert(schema.evidenceDeepAnalysis)
    .values({
      symbol: analysis.symbol,
      analysisDate: analysis.analysisDate,
      verdict: analysis.verdict,
      reasoning: analysis.reasoning,
      entryZone: analysis.entryZone,
      target: analysis.target,
      stopLoss: analysis.stopLoss,
      riskReward: analysis.riskReward,
      confidence: analysis.confidence,
      keyRisks: JSON.stringify(analysis.keyRisks),
      timeframe: analysis.timeframe,
      model: analysis.model,
      fetchedAt: analysis.fetchedAt,
      expiresAt: expires.toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.evidenceDeepAnalysis.symbol,
      set: {
        analysisDate: analysis.analysisDate,
        verdict: analysis.verdict,
        reasoning: analysis.reasoning,
        entryZone: analysis.entryZone,
        target: analysis.target,
        stopLoss: analysis.stopLoss,
        riskReward: analysis.riskReward,
        confidence: analysis.confidence,
        keyRisks: JSON.stringify(analysis.keyRisks),
        timeframe: analysis.timeframe,
        model: analysis.model,
        fetchedAt: analysis.fetchedAt,
        expiresAt: expires.toISOString(),
      },
    })
    .run();
}

// ─── Local technical indicators ───────────────────────────────────────────────

interface TechSummary {
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  trend: 'bullish' | 'bearish' | 'mixed';
  momentum5d: number | null;
  last20Candles: string;
}

function computeTechSummary(
  ohlc: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>,
): TechSummary {
  const empty: TechSummary = { rsi14: null, sma20: null, sma50: null, trend: 'mixed', momentum5d: null, last20Candles: '[]' };
  if (ohlc.length < 15) return empty;

  const closes = ohlc.map((c) => c.close);
  const n = closes.length;

  const sma = (period: number): number | null => {
    if (n < period) return null;
    return closes.slice(n - period).reduce((a, b) => a + b, 0) / period;
  };

  const sma20 = sma(20);
  const sma50 = sma(50);

  // RSI 14
  let rsi14: number | null = null;
  if (n >= 15) {
    const slice = closes.slice(n - 15);
    const changes = slice.map((c, i) => (i === 0 ? 0 : c - slice[i - 1]));
    const gains = changes.map((c) => Math.max(c, 0));
    const losses = changes.map((c) => Math.max(-c, 0));
    const avgGain = gains.slice(1).reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.slice(1).reduce((a, b) => a + b, 0) / 14;
    rsi14 = avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + avgGain / avgLoss));
  }

  const current = closes[n - 1];
  const trend: TechSummary['trend'] =
    sma20 && sma50 && current > sma20 && sma20 > sma50 ? 'bullish'
    : sma20 && sma50 && current < sma20 && sma20 < sma50 ? 'bearish'
    : 'mixed';

  const momentum5d = n >= 6
    ? Math.round(((closes[n - 1] - closes[n - 6]) / closes[n - 6]) * 10000) / 100
    : null;

  const last20 = ohlc.slice(-20).map((c) => [c.date, c.open, c.high, c.low, c.close, c.volume]);

  return {
    rsi14,
    sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    trend,
    momentum5d,
    last20Candles: JSON.stringify(last20),
  };
}

// ─── AI prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un analista de posición. Evaluás si un candidato identificado por señales evidence-based (PEAD, insider buying, options flow) tiene un setup válido para una posición de 3 a 6 meses.

Criterios clave para BUY_SETUP:
- La empresa tiene fundamentos sólidos: crecimiento de revenue, márgenes positivos
- La señal es fresh (PEAD < 20 días, o insider comprando recientemente)
- Los técnicos no muestran distribución (no RSI > 80, no breakdown reciente)
- El risk/reward mínimo aceptable es 2:1

Sé directo y brutal: si los fundamentos son débiles, la empresa pierde plata, o el setup técnico está agotado, devolvé PASS o WAIT. No infles la confianza por tener muchas señales.

Devolvé SOLO JSON válido con exactamente estos campos:
{
  "verdict": "BUY_SETUP" | "WAIT" | "PASS",
  "reasoning": "string en español, 2-3 oraciones con datos concretos incluyendo fundamentos",
  "entryZone": "string como '$820-835' o 'N/A'",
  "target": "string como '$890' o 'N/A'",
  "stopLoss": "string como '$780' o 'N/A'",
  "riskReward": "string como '2.4:1' o 'N/A'",
  "confidence": número entero entre 0 y 100,
  "keyRisks": ["riesgo 1", "riesgo 2"],
  "timeframe": "string como '3-6 meses'"
}`;

function buildFundamentalsSection(f: FundamentalData | null): string {
  if (!f) return 'Sin datos fundamentales disponibles.';
  const fmt = (v: number | null, suffix = '') => v != null ? `${v}${suffix}` : 'N/A';
  const lines = [
    `P/E trailing: ${fmt(f.peRatio)} | P/E forward: ${fmt(f.forwardPE)}`,
    `Revenue growth YoY: ${fmt(f.revenueGrowth, '%')}`,
    `Margen operativo: ${fmt(f.operatingMargin, '%')} | Margen neto: ${fmt(f.netMargin, '%')}`,
    `Beta: ${fmt(f.beta)} | Market cap: ${f.marketCap ? new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD' }).format(f.marketCap) : 'N/A'}`,
    `Deuda/Equity: ${fmt(f.debtToEquity)} | ROE: ${fmt(f.returnOnEquity, '%')}`,
    `Precio vs 52w máx: ${fmt(f.priceVs52wHigh, '%')} | Precio vs 52w mín: ${fmt(f.priceVs52wLow, '%')}`,
  ];
  return lines.join('\n');
}

function buildPrompt(
  signal: EvidenceSignal,
  tech: TechSummary,
  newsHeadlines: string,
  fundamentals: FundamentalData | null,
  sectorLine: string,
): string {
  const price = signal.currentPrice ? `$${signal.currentPrice.toFixed(2)}` : 'N/A';

  const signalLines: string[] = [];
  if (signal.pead.active) {
    const priceMove = signal.pead.priceChangePct != null ? `, precio +${signal.pead.priceChangePct.toFixed(1)}% post-earnings` : '';
    const consec = signal.pead.consecutiveBeats > 1 ? ` (${signal.pead.consecutiveBeats} trimestres consecutivos de beat)` : '';
    signalLines.push(`PEAD: beat EPS ${signal.pead.beatPercent.toFixed(1)}% hace ${signal.pead.daysSinceEarnings}d${priceMove}${consec}, ${signal.pead.daysInDriftWindow}d ventana restante`);
  }
  if (signal.insider.active) {
    const val = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(signal.insider.totalValue);
    signalLines.push(`INSIDER: ${signal.insider.numberOfBuyers} insider(s) compraron ${val}, última compra ${signal.insider.mostRecentBuyDate}`);
  }
  if (signal.optionsFlow.active) {
    signalLines.push(`OPTIONS FLOW: ${signal.optionsFlow.unusualStrikes} strikes OTM con actividad inusual, ratio C/P ${signal.optionsFlow.callPutRatio}x`);
  }

  return `Símbolo: ${signal.symbol}
Precio actual: ${price}
Convicción: ${signal.conviction.toUpperCase()} (score: ${signal.compositeScore})

SEÑALES ACTIVAS:
${signalLines.join('\n')}

SECTOR:
${sectorLine}

FUNDAMENTALES:
${buildFundamentalsSection(fundamentals)}

TÉCNICOS:
- RSI(14): ${tech.rsi14 ?? 'N/A'}
- SMA20: ${tech.sma20 ?? 'N/A'} | SMA50: ${tech.sma50 ?? 'N/A'}
- Tendencia: ${tech.trend}
- Momentum 5d: ${tech.momentum5d != null ? `${tech.momentum5d > 0 ? '+' : ''}${tech.momentum5d}%` : 'N/A'}

ÚLTIMAS 20 VELAS [date,open,high,low,close,vol]:
${tech.last20Candles}

NOTICIAS RECIENTES:
${newsHeadlines}`;
}

// ─── Parse AI response ────────────────────────────────────────────────────────

function parseAIResponse(raw: string, symbol: string, model: string): EvidenceDeepAnalysis | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verdict = String(parsed.verdict ?? '');
    if (!['BUY_SETUP', 'WAIT', 'PASS'].includes(verdict)) return null;

    return {
      symbol,
      analysisDate: new Date().toISOString().split('T')[0],
      verdict: verdict as EvidenceDeepAnalysis['verdict'],
      reasoning: String(parsed.reasoning ?? ''),
      entryZone: String(parsed.entryZone ?? 'N/A'),
      target: String(parsed.target ?? 'N/A'),
      stopLoss: String(parsed.stopLoss ?? 'N/A'),
      riskReward: String(parsed.riskReward ?? 'N/A'),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence ?? 50))),
      keyRisks: Array.isArray(parsed.keyRisks)
        ? (parsed.keyRisks as unknown[]).map(String).slice(0, 3)
        : [],
      timeframe: String(parsed.timeframe ?? '2-4 semanas'),
      model,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Per-symbol analysis ──────────────────────────────────────────────────────

async function analyzeSignal(signal: EvidenceSignal): Promise<void> {
  if (getCachedAnalysis(signal.symbol)) return;

  const [newsResult, ohlcResult, fundamentalsResult, sectorResult] = await Promise.allSettled([
    searchTavily(`${signal.symbol} stock news`, 5, 'basic'),
    getHistoricalQuotes(signal.symbol, '3mo', '1d'),
    getFundamentals(signal.symbol),
    getSectorMomentum(signal.symbol),
  ]);

  const newsHeadlines = newsResult.status === 'fulfilled' && newsResult.value.length > 0
    ? newsResult.value
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title}${a.publishedAt ? ` (${a.publishedAt.slice(0, 10)})` : ''}`)
        .join('\n')
    : 'Sin noticias disponibles.';

  const ohlc = ohlcResult.status === 'fulfilled' ? ohlcResult.value : [];
  const tech = computeTechSummary(ohlc);
  const fundamentals = fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : null;
  const sector = sectorResult.status === 'fulfilled' ? sectorResult.value : null;
  const sectorLine = sector
    ? `${sector.sectorName} (${sector.sectorEtf}) ${sector.trend === 'outperforming' ? '✅ outperforming' : sector.trend === 'underperforming' ? '⚠️ underperforming' : '➡️ neutral'} — ETF $${sector.etfPrice} vs SMA50 $${sector.sma50} (${sector.priceVsSma50Pct > 0 ? '+' : ''}${sector.priceVsSma50Pct}%)`
    : 'Sector no mapeado — analizar contexto macro manualmente';
  const prompt = buildPrompt(signal, tech, newsHeadlines, fundamentals, sectorLine);

  const { content, model } = await callAIWithModel('reasoning', prompt, SYSTEM_PROMPT, 1024);
  const analysis = parseAIResponse(content, signal.symbol, model);

  if (!analysis) {
    console.warn(`[DeepAnalysis] JSON inválido de AI para ${signal.symbol}, saltando`);
    return;
  }

  setCachedAnalysis(analysis);
  console.log(`[DeepAnalysis] ✓ ${signal.symbol} — ${analysis.verdict} (confianza: ${analysis.confidence}%, modelo: ${model})`);
}

// ─── Main trigger ─────────────────────────────────────────────────────────────

async function runDeepAnalysis(signals: EvidenceSignal[]): Promise<void> {
  if (analysisState === 'analyzing') return;

  const candidates = signals.filter(
    (s) => s.conviction === 'high' || s.conviction === 'medium',
  );
  if (!candidates.length) return;

  analysisState = 'analyzing';
  analysisTotal = candidates.length;
  analyzedCount = 0;

  console.log(`[DeepAnalysis] Iniciando análisis de ${candidates.length} señales HIGH/MEDIUM...`);

  try {
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (signal) => {
          try {
            await analyzeSignal(signal);
          } catch (err) {
            console.warn(`[DeepAnalysis] Error en ${signal.symbol}:`, (err as Error).message?.slice(0, 100));
          } finally {
            analyzedCount++;
          }
        }),
      );
    }
    console.log(`[DeepAnalysis] Completo — ${analyzedCount}/${analysisTotal} procesados`);
  } finally {
    analysisState = 'idle';
  }
}

export function triggerDeepAnalysis(signals: EvidenceSignal[]): void {
  runDeepAnalysis(signals).catch((err) =>
    console.error('[DeepAnalysis] Error fatal:', err),
  );
}

export function invalidateDeepAnalysisCache(): void {
  db.delete(schema.evidenceDeepAnalysis).run();
}
