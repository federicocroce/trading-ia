import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { updateSignalTargets } from '../db/repository.js';
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

const SYSTEM_PROMPT = `Eres un analista de posición. Evaluás si un candidato identificado por señales evidence-based (PEAD, insider buying, options flow) tiene un setup válido para comprar y mantener 3-6 meses.

REGLAS DE VEREDICTO:
- BUY_SETUP: revenue creciendo YoY, margen operativo > -5%, señal PEAD < 15 días O insider comprando, RSI < 75, R/R ≥ 2:1
- WAIT: fundamentos ok pero la señal tiene > 10 días o el técnico está sobrecomprado — esperar pullback
- PASS: revenue cayendo > 5% YoY, margen < -15%, breakdown técnico confirmado, o señal ya dentro de resistencia clave sin espacio

REGLAS DE PRECIOS (MUY IMPORTANTE):
- entryZone, target, stopLoss DEBEN estar dentro de ±30% del precio actual. Si no podés calcular un nivel razonable, usá "N/A"
- No inventes precios redondos ($100, $200) — usá el precio actual como base
- Si el precio actual es $150, entryZone debe estar entre $105-$195, target entre $105-$195, stopLoss entre $105-$195

CRITERIOS ESTRICTOS:
- Confianza > 75 solo cuando: señal fresh (< 5 días), fundamentals sólidos, sector outperforming, RSI 40-65
- Si hay dudas sobre fundamentos (datos faltantes), bajá confianza a < 60 y usá WAIT
- R/R = (target - entry) / (entry - stop). Solo BUY_SETUP si R/R ≥ 2.0

Devolvé ÚNICAMENTE JSON válido (sin markdown, sin texto extra):
{"verdict":"BUY_SETUP","reasoning":"2-3 oraciones con datos numéricos concretos","entryZone":"$X-Y","target":"$Z","stopLoss":"$W","riskReward":"X.X:1","confidence":70,"keyRisks":["riesgo 1","riesgo 2"],"timeframe":"3-6 meses"}

Ejemplo BUY_SETUP: {"verdict":"BUY_SETUP","reasoning":"NVDA reportó EPS beat de 22% hace 3 días, revenue +84% YoY, margen op. 62%. RSI en 58, SMA20 > SMA50. R/R 2.8:1 con target histórico en zona $950.","entryZone":"$850-865","target":"$950","stopLoss":"$810","riskReward":"2.8:1","confidence":78,"keyRisks":["concentración en datacenter","regulación China"],"timeframe":"3-5 meses"}
Ejemplo PASS: {"verdict":"PASS","reasoning":"Revenue -8% YoY, margen operativo -22%. Aunque hay insider buying, los fundamentos no justifican posición larga 3-6m. Setup de deuda, no de crecimiento.","entryZone":"N/A","target":"N/A","stopLoss":"N/A","riskReward":"N/A","confidence":25,"keyRisks":["quema de caja acelerada","dilución probable"],"timeframe":"N/A"}`;

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

function extractJSON(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Find first { … } block
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function parseAIResponse(raw: string, symbol: string, model: string): EvidenceDeepAnalysis | null {
  try {
    const json = extractJSON(raw);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const verdict = String(parsed.verdict ?? '');
    if (!['BUY_SETUP', 'WAIT', 'PASS'].includes(verdict)) {
      console.warn(`[DeepAnalysis] Veredicto inválido para ${symbol}: "${verdict}" — raw: ${raw.slice(0, 200)}`);
      return null;
    }

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
      timeframe: String(parsed.timeframe ?? '3-6 meses'),
      model,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[DeepAnalysis] JSON parse fallido para ${symbol}: ${(err as Error).message}. Raw: ${raw.slice(0, 300)}`);
    return null;
  }
}

// ─── Price zone parser ────────────────────────────────────────────────────────

/**
 * Parses AI-provided price string into a number. Validates it's within 30% of
 * current price (reject hallucinated values). Returns null if unparseable or invalid.
 * Supports: "$820", "$820-835" (returns midpoint), "N/A"
 */
function parsePriceZone(raw: string, currentPrice: number): number | null {
  if (!raw || raw === 'N/A' || raw.trim() === '') return null;

  const cleaned = raw.replace(/[$,\s]/g, '');

  // Range like "820-835"
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    if (!isNaN(lo) && !isNaN(hi)) {
      const mid = (lo + hi) / 2;
      const deviation = Math.abs((mid - currentPrice) / currentPrice);
      return deviation <= 0.30 ? Math.round(mid * 100) / 100 : null;
    }
  }

  // Single number like "890"
  const single = parseFloat(cleaned);
  if (!isNaN(single) && single > 0) {
    const deviation = Math.abs((single - currentPrice) / currentPrice);
    return deviation <= 0.30 ? Math.round(single * 100) / 100 : null;
  }

  return null;
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

  // Always sync AI verdict + confidence to tracking. Sync price targets only for BUY_SETUP.
  updateSignalTargets(signal.symbol, {
    aiVerdict: analysis.verdict,
    aiConfidence: analysis.confidence,
    enrichedByLlm: true,
    ...(analysis.verdict === 'BUY_SETUP' && signal.currentPrice && signal.currentPrice > 0
      ? (() => {
          const target = parsePriceZone(analysis.target, signal.currentPrice!);
          const stop = parsePriceZone(analysis.stopLoss, signal.currentPrice!);
          if (target || stop) {
            console.log(`[DeepAnalysis] → Targets actualizados: ${signal.symbol} target=$${target ?? 'N/A'} stop=$${stop ?? 'N/A'}`);
          }
          return {
            ...(target != null ? { targetPrice: target } : {}),
            ...(stop != null ? { stopLoss: stop } : {}),
          };
        })()
      : {}),
  });
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
