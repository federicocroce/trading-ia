import type {
  IntegratedSignal,
  SignalAction,
  AnalysisBreakdown,
  TechnicalSummary,
  FundamentalSummary,
  TASignal,
  FASignal,
  SentimentType,
  SymbolTrend,
} from '@trading/shared';
import { INTEGRATED_SIGNAL_PROMPT, getPlazaForSymbol, PLAZA_CONFIG } from '@trading/shared';
import { getActiveSymbolList } from '../db/repository.js';
import { askLMStudio } from '../shared/lmstudio.js';
import { askGroq } from '../shared/groq.js';
import { askOpenRouter } from '../shared/openrouter.js';
import { askClaude } from '../shared/claude.js';
import { getAllTechnicalSummaries, invalidateTechnicalCache } from '../technical/technical-analysis.service.js';
import { getAllFundamentalSummaries, invalidateFundamentalCache } from '../fundamental/fundamental-analysis.service.js';
import { getIntelligence } from '../news/news-intelligence.service.js';

const SIGNAL_CACHE_TTL = 20 * 60 * 1000; // 20 minutes
let cachedSignals: IntegratedSignal[] = [];
let signalsCacheTimestamp = 0;

// --- Build Groq prompt ---

function rsiZone(rsi: number): string {
  if (rsi < 30) return 'SOBREVENTA';
  if (rsi < 40) return 'CERCA_SOBREVENTA';
  if (rsi > 70) return 'SOBRECOMPRA';
  if (rsi > 60) return 'CERCA_SOBRECOMPRA';
  return 'NEUTRAL';
}

function range52wPosition(high: number | null, low: number | null, price: number): string | null {
  if (high == null || low == null || high === low) return null;
  const pct = Math.round(((price - low) / (high - low)) * 100);
  return `${pct}% del rango (0%=minimo, 100%=maximo)`;
}

function buildUserMessage(
  technicals: TechnicalSummary[],
  fundamentals: FundamentalSummary[],
  sentimentMap: Map<string, { score: number; sentiment: SentimentType; headlines: string[] }>,
): string {
  const techMap = new Map(technicals.map((t) => [t.symbol, t]));
  const fundMap = new Map(fundamentals.map((f) => [f.symbol, f]));

  const lines: string[] = [];

  for (const symbol of getActiveSymbolList()) {
    const plaza = getPlazaForSymbol(symbol);
    const plazaLabel = PLAZA_CONFIG[plaza].label;
    lines.push(`=== ${symbol} (${plazaLabel}) ===`);

    // Technical
    const tech = techMap.get(symbol);
    if (tech && tech.indicators.rsi14 != null) {
      const ind = tech.indicators;
      const rsiLabel = rsiZone(ind.rsi14!);
      const macdStr = ind.macd
        ? `MACD(linea=${ind.macd.macdLine}, signal=${ind.macd.signalLine}, hist=${ind.macd.histogram}${ind.macd.histogram > 0 ? ' POSITIVO' : ' NEGATIVO'})`
        : 'MACD=N/A';
      const bbStr = ind.bollingerBands
        ? `BB(sup=${ind.bollingerBands.upper}, med=${ind.bollingerBands.middle}, inf=${ind.bollingerBands.lower})`
        : 'BB=N/A';
      lines.push(
        `TECNICO: RSI=${ind.rsi14?.toFixed(1)} (${rsiLabel}), ${macdStr}`,
      );
      lines.push(
        `  SMA20=$${ind.sma20} (precio ${ind.priceVsSma20 > 0 ? '+' : ''}${ind.priceVsSma20}%), SMA50=$${ind.sma50} (precio ${ind.priceVsSma50 > 0 ? '+' : ''}${ind.priceVsSma50}%)`,
      );
      lines.push(
        `  ${bbStr}, precio=$${ind.currentPrice.toFixed(2)}, volumen_vs_promedio=${ind.volumeRatio}x`,
      );
      lines.push(`  Score heuristico tecnico: ${tech.score > 0 ? '+' : ''}${tech.score}/100 (${tech.signal})`);
    } else {
      lines.push(`TECNICO: sin datos historicos suficientes`);
    }

    // Fundamental
    const fund = fundMap.get(symbol);
    if (fund) {
      const d = fund.data;
      const parts: string[] = [];
      if (d.peRatio != null) parts.push(`P/E=${d.peRatio.toFixed(1)}`);
      if (d.forwardPE != null) parts.push(`P/E forward=${d.forwardPE.toFixed(1)}`);
      if (d.eps != null) parts.push(`EPS=$${d.eps.toFixed(2)}`);
      if (d.marketCap != null) parts.push(`Cap=${formatCap(d.marketCap)}`);
      if (d.dividendYield != null && d.dividendYield > 0) parts.push(`Dividendo=${(d.dividendYield * 100).toFixed(1)}%`);

      if (d.fiftyTwoWeekHigh != null && d.fiftyTwoWeekLow != null) {
        parts.push(`52sem: $${d.fiftyTwoWeekLow.toFixed(2)}-$${d.fiftyTwoWeekHigh.toFixed(2)}`);
        const pos = range52wPosition(d.fiftyTwoWeekHigh, d.fiftyTwoWeekLow, d.currentPrice);
        if (pos) parts.push(`Posicion en rango: ${pos}`);
      }

      if (parts.length > 0) {
        lines.push(`FUNDAMENTAL: ${parts.join(', ')}`);
        lines.push(`  Score heuristico fundamental: ${fund.score > 0 ? '+' : ''}${fund.score}/100 (${fund.signal})`);
      } else {
        lines.push(`FUNDAMENTAL: sin datos disponibles (crypto)`);
      }
    } else {
      lines.push(`FUNDAMENTAL: sin datos`);
    }

    // Sentiment
    const sent = sentimentMap.get(symbol);
    if (sent && (sent.headlines.length > 0 || sent.score !== 0)) {
      const sentScaled = Math.round(sent.score * 100);
      lines.push(
        `SENTIMIENTO: score=${sentScaled > 0 ? '+' : ''}${sentScaled}/100, tendencia=${sent.sentiment}, ${sent.headlines.length} noticias`,
      );
      if (sent.headlines.length > 0) {
        lines.push(`  Titulares:`);
        for (const h of sent.headlines.slice(0, 3)) {
          lines.push(`  - "${h}"`);
        }
      }
    } else {
      lines.push(`SENTIMIENTO: sin noticias relevantes recientes, score=0`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

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

function formatCap(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toString();
}

// --- Fallback: algorithmic signals without AI ---

function buildFallbackSignal(
  symbol: string,
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: { score: number; sentiment: SentimentType; headlines: string[] } | undefined,
): IntegratedSignal {
  const techScore = tech?.score ?? 0;
  const fundScore = fund?.score ?? 0;
  const sentScore = sent ? Math.round(sent.score * 100) : 0;

  const avg = (techScore + fundScore + sentScore) / 3;

  let action: SignalAction;
  let positiveCount = 0;
  let negativeCount = 0;
  if (techScore > 20) positiveCount++;
  if (techScore < -20) negativeCount++;
  if (fundScore > 15) positiveCount++;
  if (fundScore < -15) negativeCount++;
  if (sentScore > 20) positiveCount++;
  if (sentScore < -20) negativeCount++;

  if (positiveCount >= 2) action = 'BUY';
  else if (negativeCount >= 2) action = 'SELL';
  else if (positiveCount === 0 && negativeCount === 0) action = 'HOLD';
  else action = 'WATCH';

  const confidence = Math.min(90, Math.max(20, 50 + Math.abs(avg)));

  return {
    symbol,
    action,
    confidence: Math.round(confidence),
    reasoning: `Score promedio: ${avg.toFixed(0)} (T:${techScore}, F:${fundScore}, S:${sentScore})`,
    breakdown: {
      technical: {
        signal: tech?.signal ?? 'neutral',
        score: techScore,
        keyFactors: tech?.indicators.rsi14 != null
          ? [`RSI ${tech.indicators.rsi14.toFixed(0)}`, `vs SMA50 ${tech.indicators.priceVsSma50.toFixed(1)}%`]
          : ['Sin datos'],
      },
      fundamental: {
        signal: fund?.signal ?? 'fair',
        score: fundScore,
        keyFactors: fund?.data.peRatio != null
          ? [`P/E ${fund.data.peRatio.toFixed(1)}`]
          : ['Sin datos'],
      },
      sentiment: {
        signal: sent?.sentiment ?? 'neutral',
        score: sentScore,
        keyFactors: sent?.headlines.slice(0, 2) ?? ['Sin noticias'],
      },
    },
    timestamp: Date.now(),
  };
}

// --- Main pipeline ---

export async function getAllIntegratedSignals(): Promise<IntegratedSignal[]> {
  const now = Date.now();
  if (cachedSignals.length > 0 && now - signalsCacheTimestamp < SIGNAL_CACHE_TTL) {
    return cachedSignals;
  }

  console.log('[signals] Building integrated signals...');

  // Fetch all 3 data sources in parallel
  const [technicals, fundamentals, intelligence] = await Promise.all([
    getAllTechnicalSummaries(),
    getAllFundamentalSummaries(),
    getIntelligence(),
  ]);

  // Extract per-symbol sentiment from intelligence plazas
  const sentimentMap = new Map<string, { score: number; sentiment: SentimentType; headlines: string[] }>();
  for (const plaza of intelligence.plazas) {
    for (const trend of plaza.symbolTrends as SymbolTrend[]) {
      sentimentMap.set(trend.symbol, {
        score: trend.sentimentScore,
        sentiment: trend.sentiment,
        headlines: trend.topHeadlines,
      });
    }
  }

  // Try AI synthesis: Groq → OpenRouter → Claude → algorithmic fallback
  try {
    const userMessage = buildUserMessage(technicals, fundamentals, sentimentMap);
    let raw: string | null = null;
    let usedEngine = 'algorithmic';

    // 1. LM Studio (local, no API key needed)
    try {
      raw = await askLMStudio(userMessage, INTEGRATED_SIGNAL_PROMPT, 2048);
      usedEngine = 'lmstudio';
      console.log(`[signals] LM Studio: ${raw.length} chars`);
    } catch (lmErr) {
      console.warn('[signals] LM Studio failed:', (lmErr as Error).message.slice(0, 120));
    }

    // 2-4. Fallbacks deshabilitados — solo LM Studio local
    // Para reactivar: descomentar Groq/OpenRouter/Claude
    // if (!raw && process.env.GROQ_API_KEY) { ... }
    // if (!raw && process.env.OPENROUTER_API_KEY) { ... }
    // if (!raw && process.env.ANTHROPIC_API_KEY) { ... }

    if (!raw) throw new Error('LM Studio failed — único proveedor habilitado');

    const parsed = JSON.parse(raw);
    const signals: Array<{
      symbol: string;
      action: SignalAction;
      confidence: number;
      reasoning: string;
      technical: { signal: TASignal; score: number; keyFactors: string[] };
      fundamental: { signal: FASignal; score: number; keyFactors: string[] };
      sentiment: { signal: SentimentType; score: number; keyFactors: string[] };
    }> = parsed.signals ?? parsed;

    if (!Array.isArray(signals)) throw new Error('Invalid response format');

    console.log(`[signals] ${usedEngine} generated ${signals.length} integrated signals`);

    const defaultFundamental = { signal: 'fair' as FASignal, score: 0, keyFactors: ['Sin datos fundamentales'] };

    cachedSignals = signals.map((s) => ({
      symbol: s.symbol,
      action: s.action,
      confidence: s.confidence,
      reasoning: s.reasoning,
      breakdown: {
        technical: s.technical ?? { signal: 'neutral', score: 0, keyFactors: ['Sin datos'] },
        fundamental: s.fundamental ?? defaultFundamental,
        sentiment: s.sentiment ?? { signal: 'neutral', score: 0, keyFactors: ['Sin datos'] },
      },
      timestamp: Date.now(),
    }));
  } catch (err) {
    console.warn('[signals] AI synthesis failed, using algorithmic fallback:', (err as Error).message);

    const techMap = new Map(technicals.map((t) => [t.symbol, t]));
    const fundMap = new Map(fundamentals.map((f) => [f.symbol, f]));

    cachedSignals = getActiveSymbolList().map((symbol) =>
      buildFallbackSignal(symbol, techMap.get(symbol), fundMap.get(symbol), sentimentMap.get(symbol)),
    );
  }

  signalsCacheTimestamp = Date.now();
  return cachedSignals;
}

export async function refreshIntegratedSignals(): Promise<IntegratedSignal[]> {
  invalidateTechnicalCache();
  invalidateFundamentalCache();
  cachedSignals = [];
  signalsCacheTimestamp = 0;
  return getAllIntegratedSignals();
}
