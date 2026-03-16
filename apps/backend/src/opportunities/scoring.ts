import type {
  Opportunity,
  OpportunitySector,
  SignalAction,
  TechnicalSummary,
  FundamentalSummary,
  SentimentType,
  TASignal,
  FASignal,
  ReturnEstimate,
  MarketPlaza,
} from '@trading/shared';
import { OPPORTUNITY_UNIVERSE, getSectorForSymbol } from '@trading/shared';

// --- Normalización a escala 0-100 ---

export function normalizeTechnical(score: number): number {
  return (score + 100) / 2; // -100..+100 → 0..100
}

export function normalizeFundamental(score: number): number {
  return (score + 100) / 2; // -100..+100 → 0..100
}

export function normalizeSentiment(score: number): number {
  return (score + 1) * 50; // -1..+1 → 0..100
}

// --- Pesos por horizonte ---

export interface HorizonWeights {
  sentiment: number;
  technical: number;
  fundamental: number;
}

export const SHORT_TERM_WEIGHTS: HorizonWeights = {
  sentiment: 0.40,
  technical: 0.45,
  fundamental: 0.15,
};

export const MEDIUM_TERM_WEIGHTS: HorizonWeights = {
  sentiment: 0.20,
  technical: 0.30,
  fundamental: 0.50,
};

// --- Scoring ---

export function computeHorizonScore(
  techScore: number,
  fundScore: number,
  sentScore: number,
  weights: HorizonWeights,
): number {
  const normTech = normalizeTechnical(techScore);
  const normFund = normalizeFundamental(fundScore);
  const normSent = normalizeSentiment(sentScore);

  return Math.round(
    normSent * weights.sentiment +
    normTech * weights.technical +
    normFund * weights.fundamental,
  );
}

export function computeCompositeScore(
  techScore: number,
  fundScore: number,
  sentScore: number,
): { shortTerm: number; mediumTerm: number; composite: number } {
  const shortTerm = computeHorizonScore(techScore, fundScore, sentScore, SHORT_TERM_WEIGHTS);
  const mediumTerm = computeHorizonScore(techScore, fundScore, sentScore, MEDIUM_TERM_WEIGHTS);
  const composite = Math.round((shortTerm + mediumTerm) / 2);
  return { shortTerm, mediumTerm, composite };
}

// --- Confianza (alineación de fuentes) ---

export function computeConfidence(techScore: number, fundScore: number, sentScore: number): number {
  const sentScaled = sentScore * 100;
  const signs = [
    techScore > 10 ? 1 : techScore < -10 ? -1 : 0,
    fundScore > 10 ? 1 : fundScore < -10 ? -1 : 0,
    sentScaled > 10 ? 1 : sentScaled < -10 ? -1 : 0,
  ];
  const active = signs.filter((s) => s !== 0);
  if (active.length === 0) return 40;
  const allSame = active.every((s) => s === active[0]);
  if (allSame && active.length === 3) return 75;
  if (allSame && active.length === 2) return 60;
  return 45;
}

// --- Action ---

export function scoreToAction(score: number, inPortfolio: boolean): SignalAction {
  if (score >= 60) return 'BUY';
  if (score >= 40) return inPortfolio ? 'HOLD' : 'WATCH';
  return inPortfolio ? 'SELL' : 'WATCH';
}

// --- Sector ↔ Plaza mapping ---

const SECTOR_TO_PLAZA: Record<OpportunitySector, MarketPlaza> = {
  'argentina-energy': 'argentina-energy',
  'argentina-finance': 'argentina-finance',
  'argentina-cedears': 'argentina-cedears',
  'us-energy': 'us-energy',
  'us-tech': 'us-tech',
  crypto: 'crypto',
  bonds: 'bonds',
};

export function sectorToPlaza(sector: OpportunitySector): MarketPlaza {
  return SECTOR_TO_PLAZA[sector];
}

export function filterSymbolsByPositiveSectors(
  symbols: string[],
  plazaSentiments: Map<MarketPlaza, SentimentType>,
  portfolioSymbols: Set<string>,
): string[] {
  const allNegative = [...plazaSentiments.values()].every((s) => s === 'negative');

  return symbols.filter((symbol) => {
    // Siempre incluir símbolos del portfolio (para señales SELL)
    if (portfolioSymbols.has(symbol)) return true;
    // Si todos los sectores son negativos → no filtrar (safety valve)
    if (allNegative) return true;

    const sector = getSectorForSymbol(symbol);
    if (!sector) return true; // sin sector = no filtrar

    const plaza = sectorToPlaza(sector);
    const sentiment = plazaSentiments.get(plaza);
    // Sin datos de sentimiento = no filtrar
    if (!sentiment) return true;
    // Filtrar solo los negativos
    return sentiment !== 'negative';
  });
}

// --- Anti-hype filters ---

export interface AntiHypeFilterResult {
  totalCandidates: number;
  passedAll: number;
  filtered: string[];
  rejected: Array<{ symbol: string; reasons: string[] }>;
}

export function applyAntiHypeFilters(
  symbols: string[],
  techMap: Map<string, TechnicalSummary>,
  portfolioSymbols: Set<string>,
): AntiHypeFilterResult {
  const filtered: string[] = [];
  const rejected: Array<{ symbol: string; reasons: string[] }> = [];

  for (const symbol of symbols) {
    // Portfolio symbols always pass (for SELL signals)
    if (portfolioSymbols.has(symbol)) {
      filtered.push(symbol);
      continue;
    }

    const tech = techMap.get(symbol);
    if (!tech) {
      filtered.push(symbol); // no data = no filter
      continue;
    }

    const reasons: string[] = [];
    const ind = tech.indicators;

    // Filter 1: Price > SMA200 (long-term bullish trend)
    if (ind.sma200 != null && ind.currentPrice <= ind.sma200) {
      reasons.push(`Precio (${ind.currentPrice.toFixed(2)}) <= SMA200 (${ind.sma200.toFixed(2)})`);
    }

    // Filter 2: RSI between 40-65 (not overbought)
    if (ind.rsi14 != null && (ind.rsi14 < 40 || ind.rsi14 > 65)) {
      reasons.push(`RSI ${ind.rsi14.toFixed(0)} fuera de rango 40-65`);
    }

    // Filter 3: Volume > 150% of 20-day average
    if (ind.volumeRatio < 1.5) {
      reasons.push(`Volumen ratio ${ind.volumeRatio.toFixed(2)}x < 1.5x`);
    }

    if (reasons.length === 0) {
      filtered.push(symbol);
    } else {
      rejected.push({ symbol, reasons });
    }
  }

  return {
    totalCandidates: symbols.length,
    passedAll: filtered.length,
    filtered,
    rejected,
  };
}

// --- Return estimates ---

function estimateShortTermReturn(
  tech: TechnicalSummary | undefined,
  catalysts: string[],
  shortTermScore: number,
): ReturnEstimate {
  const distToSma20 = tech?.indicators.priceVsSma20 ?? 0;
  const base = Math.round(Math.max(-5, Math.min(10, -distToSma20 * 0.4)));

  return {
    lowPercent: base - 4,
    midPercent: base,
    highPercent: base + 6,
    confidence: shortTermScore > 60 ? 65 : shortTermScore > 50 ? 50 : 40,
    keyDrivers: catalysts.slice(0, 2),
  };
}

function estimateMediumTermReturn(
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  mediumTermScore: number,
): ReturnEstimate {
  const distToSma50 = tech?.indicators.priceVsSma50 ?? 0;
  const fundScore = fund?.score ?? 0;
  const base = Math.round(
    Math.max(-8, Math.min(25, -distToSma50 * 0.5 + (fundScore > 0 ? 5 : fundScore < 0 ? -3 : 0))),
  );

  return {
    lowPercent: base - 6,
    midPercent: base,
    highPercent: base + 12,
    confidence: mediumTermScore > 60 ? 60 : mediumTermScore > 50 ? 45 : 35,
    keyDrivers: [
      fundScore > 0 ? 'Fundamentales soportan upside' : 'Sin catalizador fundamental claro',
      distToSma50 < -5
        ? `Precio ${Math.abs(distToSma50).toFixed(0)}% debajo de SMA50 — potencial mean reversion`
        : 'Cerca de promedio de mediano plazo',
    ],
  };
}

// --- Build opportunity completa ---

export interface SentimentInput {
  score: number; // -1..+1
  sentiment: SentimentType;
  headlines: string[];
}

export function buildAlgorithmicOpportunity(
  symbol: string,
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: SentimentInput | undefined,
  inPortfolio: boolean,
  portfolioQuantity?: number,
): Opportunity | null {
  const techScore = tech?.score ?? 0;
  const fundScore = fund?.score ?? 0;
  const sentScore = sent?.score ?? 0;

  const sector = getSectorForSymbol(symbol);
  if (!sector) return null;

  const { shortTerm, mediumTerm, composite } = computeCompositeScore(techScore, fundScore, sentScore);
  const action = scoreToAction(composite, inPortfolio);
  const confidence = computeConfidence(techScore, fundScore, sentScore);
  const currentPrice = tech?.indicators.currentPrice ?? fund?.data.currentPrice ?? 0;
  const rsi = tech?.indicators.rsi14;
  const pe = fund?.data.peRatio;
  const fpe = fund?.data.forwardPE;
  const sentScaled = Math.round(sentScore * 100);
  const distToSma50 = tech?.indicators.priceVsSma50 ?? 0;
  const distToSma200 = tech?.indicators.priceVsSma200 ?? 0;

  // Catalysts
  const catalysts: string[] = [];
  if (rsi != null && rsi < 40) catalysts.push(`RSI en ${rsi.toFixed(0)} — potencial rebote tecnico`);
  if (techScore > 0 && tech?.indicators.macd?.histogram && tech.indicators.macd.histogram > 0)
    catalysts.push('MACD positivo confirma momentum');
  if (fundScore > 15) catalysts.push('Valuacion por debajo de promedios historicos');
  if (fpe != null && pe != null && fpe < pe * 0.85)
    catalysts.push(`Forward P/E (${fpe.toFixed(1)}) mejora vs actual (${pe.toFixed(1)})`);
  if (sentScaled > 20) catalysts.push('Noticias recientes positivas');
  if (catalysts.length === 0) catalysts.push('Potencial de recuperacion tecnica');

  // Risks
  const risks: string[] = [];
  if (rsi != null && rsi > 60) risks.push(`RSI en ${rsi.toFixed(0)} — posible sobrecompra`);
  if (fundScore < -10) risks.push('Valuacion elevada vs fundamentales');
  if (sentScaled < -10) risks.push('Sentimiento negativo en noticias');
  if (risks.length === 0) risks.push('Volatilidad general de mercado');

  // Reasoning
  const reasonParts: string[] = [];
  if (techScore > 0) reasonParts.push(`momentum tecnico positivo (score ${techScore})`);
  else if (techScore < 0) reasonParts.push(`debilidad tecnica (score ${techScore})`);
  if (fundScore > 15) reasonParts.push('valuacion atractiva');
  else if (fundScore < -15) reasonParts.push('valuacion elevada');
  if (rsi != null && rsi < 35) reasonParts.push(`RSI ${rsi.toFixed(0)} sugiere sobreventa`);
  if (sentScaled > 20) reasonParts.push('sentimiento positivo en noticias');

  const reasoning =
    reasonParts.length > 0
      ? `${symbol}: ${reasonParts.join(', ')}. Score ${composite}/100.`
      : `${symbol}: datos mixtos, requiere mas analisis. Score ${composite}/100.`;

  return {
    symbol,
    sector,
    sectorLabel: OPPORTUNITY_UNIVERSE[sector].label,
    currentPrice,
    opportunityScore: composite,
    action,
    confidence,
    shortTerm: estimateShortTermReturn(tech, catalysts, shortTerm),
    mediumTerm: estimateMediumTermReturn(tech, fund, mediumTerm),
    reasoning,
    catalysts: catalysts.slice(0, 3),
    risks: risks.slice(0, 2),
    breakdown: {
      technical: {
        signal: (tech?.signal ?? 'neutral') as TASignal,
        score: techScore,
        keyFactors:
          rsi != null
            ? [
                `RSI ${rsi.toFixed(0)} — ${rsi < 30 ? 'sobreventa' : rsi < 40 ? 'cerca de sobreventa' : rsi > 70 ? 'sobrecompra' : 'neutral'}`,
                `Precio ${distToSma50 > 0 ? '+' : ''}${distToSma50.toFixed(1)}% vs SMA50`,
              ]
            : ['Sin datos tecnicos'],
      },
      fundamental: {
        signal: (fund?.signal ?? 'fair') as FASignal,
        score: fundScore,
        keyFactors:
          pe != null
            ? [
                `P/E ${pe.toFixed(1)}${fpe ? ` → Forward ${fpe.toFixed(1)}` : ''}`,
                fund?.data.dividendYield && fund.data.dividendYield > 0.01
                  ? `Dividendo ${(fund.data.dividendYield * 100).toFixed(1)}%`
                  : 'Sin dividendo',
              ]
            : ['Sin datos fundamentales (crypto o datos no disponibles)'],
      },
      sentiment: {
        signal: (sent?.sentiment ?? 'neutral') as SentimentType,
        score: sentScaled,
        keyFactors:
          sent?.headlines.length ? sent.headlines.slice(0, 2) : ['Sin noticias relevantes recientes'],
      },
    },
    inPortfolio,
    portfolioQuantity,
    timestamp: Date.now(),
    scoringMethod: 'hybrid',
    horizonScores: { shortTerm, mediumTerm },
  };
}
