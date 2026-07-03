import type {
  Opportunity,
  OpportunitySector,
  ConfluenceDetail,
  SignalAction,
  TechnicalSummary,
  FundamentalSummary,
  SentimentType,
  TASignal,
  FASignal,
  ReturnEstimate,
  MarketPlaza,
  TradeLevels,
  TimingView,
  ActionCondition,
  ConvictionTier,
  PortfolioContext,
} from '@trading/shared';
import { OPPORTUNITY_UNIVERSE, getSectorForSymbol, ACTION_THRESHOLDS } from '@trading/shared';
import { getActiveWeights } from '../intelligence/weight-adjustment.service.js';
import { getSectorForSymbolDynamic, getSectorLabelDynamic, getClassificationForSymbol } from '../discovery/discovery-registry.js';
import { detectSignalConflicts } from './signal-conflicts.js';
import { applyAxisVetos, detectCrossConflicts, resolveFinalVerdict, computeMacroAdjustment } from './verdicts.service.js';
import { computePortfolioAdjustment } from './portfolio-risk.service.js';
import { factorsForSymbol } from './risk-factor-map.js';
import { anticipatoryUpgrade } from './anticipatory-alerts.js';
import { computeConfluencePercent } from './confluence.js';
import { envNumber } from '../shared/env-number.js';

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

export function normalizeEvidence(score: number): number {
  return (score + 100) / 2; // -100..+100 → 0..100
}

// --- Pesos por horizonte (4 ejes: tech, fund, sent, evidence) ---

export interface HorizonWeights {
  sentiment: number;
  technical: number;
  fundamental: number;
  evidence: number;
}

export const SHORT_TERM_WEIGHTS: HorizonWeights = {
  technical: 0.35,
  sentiment: 0.30,
  evidence: 0.20,
  fundamental: 0.15,
};

export const MEDIUM_TERM_WEIGHTS: HorizonWeights = {
  fundamental: 0.35,
  technical: 0.30,
  evidence: 0.20,
  sentiment: 0.15,
};

// --- Scoring ---

export function computeHorizonScore(
  techScore: number,
  fundScore: number,
  sentScore: number,
  weights: HorizonWeights,
  evidenceScore = 0,
): number {
  const normTech = normalizeTechnical(techScore);
  const normFund = normalizeFundamental(fundScore);
  const normSent = normalizeSentiment(sentScore);
  const normEvidence = normalizeEvidence(evidenceScore);

  return Math.round(
    normSent * weights.sentiment +
    normTech * weights.technical +
    normFund * weights.fundamental +
    normEvidence * weights.evidence,
  );
}

export function computeCompositeScore(
  techScore: number,
  fundScore: number,
  sentScore: number,
  overrideWeights?: { shortTerm: HorizonWeights; mediumTerm: HorizonWeights },
  evidenceScore = 0,
): { shortTerm: number; mediumTerm: number; composite: number } {
  let shortWeights: HorizonWeights;
  let medWeights: HorizonWeights;
  if (overrideWeights) {
    shortWeights = overrideWeights.shortTerm;
    medWeights = overrideWeights.mediumTerm;
  } else {
    try {
      const w = getActiveWeights();
      // Back-compat: DB weights may not have evidence yet — default 0 and renormalize
      const dbShort = w.shortTerm as Partial<HorizonWeights>;
      const dbMed = w.mediumTerm as Partial<HorizonWeights>;
      shortWeights = withEvidenceDefault(dbShort);
      medWeights = withEvidenceDefault(dbMed);
    } catch {
      shortWeights = SHORT_TERM_WEIGHTS;
      medWeights = MEDIUM_TERM_WEIGHTS;
    }
  }
  const shortTerm = computeHorizonScore(techScore, fundScore, sentScore, shortWeights, evidenceScore);
  const mediumTerm = computeHorizonScore(techScore, fundScore, sentScore, medWeights, evidenceScore);
  const composite = Math.round(shortTerm * 0.4 + mediumTerm * 0.6);
  return { shortTerm, mediumTerm, composite };
}

/**
 * Back-compat: pesos viejos de DB (3 ejes) → 4 ejes. Si no hay evidence, se
 * asigna 0.20 a evidence proporcionalmente al recorte de los 3 ejes existentes.
 * Si los pesos ya suman ≈1.20 (incluyen evidence), se respetan tal cual.
 */
function withEvidenceDefault(w: Partial<HorizonWeights>): HorizonWeights {
  const tech = w.technical ?? 0;
  const fund = w.fundamental ?? 0;
  const sent = w.sentiment ?? 0;
  const evidence = w.evidence;
  if (evidence != null && evidence > 0) {
    return { technical: tech, fundamental: fund, sentiment: sent, evidence };
  }
  // Old 3-axis weights: reserve 20% for evidence by scaling others to 80%
  const total = tech + fund + sent;
  if (total === 0) return SHORT_TERM_WEIGHTS;
  const scale = 0.80 / total;
  return {
    technical: tech * scale,
    fundamental: fund * scale,
    sentiment: sent * scale,
    evidence: 0.20,
  };
}

// --- Confianza por confluencia de señales ---

type Vote = { name: string; direction: 'bullish' | 'bearish' | 'neutral' };

function computeConfluence(
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: SentimentInput | undefined,
): ConfluenceDetail {
  const votes: Vote[] = [];
  const ind = tech?.indicators;

  // =====================================================
  // TECHNICAL VOTES (~11 señales)
  // =====================================================
  if (ind) {
    // 1. RSI
    if (ind.rsi14 != null) {
      if (ind.rsi14 < 35) votes.push({ name: `RSI ${ind.rsi14.toFixed(0)} (sobreventa)`, direction: 'bullish' });
      else if (ind.rsi14 > 70) votes.push({ name: `RSI ${ind.rsi14.toFixed(0)} (sobrecompra)`, direction: 'bearish' });
      else votes.push({ name: `RSI ${ind.rsi14.toFixed(0)} (neutral)`, direction: 'neutral' });
    }

    // 2. MACD histogram
    if (ind.macd) {
      if (ind.macd.histogram > 0) votes.push({ name: 'MACD histograma positivo', direction: 'bullish' });
      else votes.push({ name: 'MACD histograma negativo', direction: 'bearish' });
    }

    // 3. Precio vs SMA200 (tendencia largo plazo)
    if (ind.sma200 != null) {
      if (ind.currentPrice > ind.sma200) votes.push({ name: 'Precio > SMA200', direction: 'bullish' });
      else votes.push({ name: 'Precio < SMA200', direction: 'bearish' });
    }

    // 4. Precio vs SMA50 (tendencia mediano plazo)
    if (ind.sma50 != null) {
      if (ind.currentPrice > ind.sma50) votes.push({ name: 'Precio > SMA50', direction: 'bullish' });
      else votes.push({ name: 'Precio < SMA50', direction: 'bearish' });
    }

    // 5. Golden/Death cross
    if (ind.crossovers?.goldenCross) votes.push({ name: 'Golden Cross reciente', direction: 'bullish' });
    if (ind.crossovers?.deathCross) votes.push({ name: 'Death Cross reciente', direction: 'bearish' });

    // 6. Stochastic
    if (ind.stochastic) {
      if (ind.stochastic.k < 20 && ind.stochastic.k > ind.stochastic.d)
        votes.push({ name: 'Stochastic sobreventa + cruce alcista', direction: 'bullish' });
      else if (ind.stochastic.k > 80 && ind.stochastic.k < ind.stochastic.d)
        votes.push({ name: 'Stochastic sobrecompra + cruce bajista', direction: 'bearish' });
      else
        votes.push({ name: `Stochastic K=${ind.stochastic.k.toFixed(0)}`, direction: 'neutral' });
    }

    // 7. Bollinger position
    if (ind.bollingerBands) {
      const range = ind.bollingerBands.upper - ind.bollingerBands.lower;
      if (range > 0) {
        const pos = (ind.currentPrice - ind.bollingerBands.lower) / range;
        if (pos < 0.2) votes.push({ name: 'Precio en banda inferior Bollinger', direction: 'bullish' });
        else if (pos > 0.8) votes.push({ name: 'Precio en banda superior Bollinger', direction: 'bearish' });
        else votes.push({ name: 'Precio en rango medio Bollinger', direction: 'neutral' });
      }
    }

    // 8. OBV
    if (ind.obvTrend === 'rising') votes.push({ name: 'OBV en acumulación', direction: 'bullish' });
    else if (ind.obvTrend === 'falling') votes.push({ name: 'OBV en distribución', direction: 'bearish' });

    // 9. OBV divergence (strong signal)
    if (ind.obvDivergence) {
      votes.push({
        name: `Divergencia OBV (${ind.obvTrend === 'rising' ? 'alcista' : 'bajista'})`,
        direction: ind.obvTrend === 'rising' ? 'bullish' : 'bearish',
      });
    }

    // 10. Soporte/resistencia cercano
    if (ind.nearestSupport != null && ind.nearestSupport < 3)
      votes.push({ name: `Cerca de soporte (${ind.nearestSupport.toFixed(1)}%)`, direction: 'bullish' });
    if (ind.nearestResistance != null && ind.nearestResistance < 3)
      votes.push({ name: `Cerca de resistencia (${ind.nearestResistance.toFixed(1)}%)`, direction: 'bearish' });

    // 11. Volumen
    if (ind.volumeRatio > 1.5) votes.push({ name: `Volumen alto (${ind.volumeRatio.toFixed(1)}x)`, direction: tech?.score != null && tech.score > 0 ? 'bullish' : 'bearish' });
  }

  // =====================================================
  // FUNDAMENTAL VOTES (~5 señales independientes)
  // =====================================================
  if (fund) {
    const d = fund.data;

    // F1. P/E Ratio — valuación actual
    if (d.peRatio != null && d.eps != null) {
      if (d.peRatio > 0 && d.peRatio < 15 && d.eps > 0)
        votes.push({ name: `P/E ${d.peRatio.toFixed(1)} (barato)`, direction: 'bullish' });
      else if (d.peRatio > 30)
        votes.push({ name: `P/E ${d.peRatio.toFixed(1)} (caro)`, direction: 'bearish' });
      else if (d.peRatio > 0)
        votes.push({ name: `P/E ${d.peRatio.toFixed(1)} (razonable)`, direction: 'neutral' });
      else
        votes.push({ name: `P/E negativo (perdidas)`, direction: 'bearish' });
    }

    // F2. Forward P/E vs P/E — crecimiento esperado
    if (d.forwardPE != null && d.peRatio != null && d.peRatio > 0) {
      if (d.forwardPE < d.peRatio * 0.8)
        votes.push({ name: `Forward P/E ${d.forwardPE.toFixed(1)} mejora vs ${d.peRatio.toFixed(1)}`, direction: 'bullish' });
      else if (d.forwardPE > d.peRatio * 1.2)
        votes.push({ name: `Forward P/E ${d.forwardPE.toFixed(1)} empeora vs ${d.peRatio.toFixed(1)}`, direction: 'bearish' });
    }

    // F3. Dividendo
    if (d.dividendYield != null) {
      if (d.dividendYield > 0.03)
        votes.push({ name: `Dividendo ${(d.dividendYield * 100).toFixed(1)}% (atractivo)`, direction: 'bullish' });
      else if (d.dividendYield > 0.01)
        votes.push({ name: `Dividendo ${(d.dividendYield * 100).toFixed(1)}%`, direction: 'neutral' });
    }

    // F4. Posición vs máximo 52 semanas
    if (d.priceVs52wHigh != null) {
      if (d.priceVs52wHigh < -25)
        votes.push({ name: `${Math.abs(d.priceVs52wHigh).toFixed(0)}% debajo de max 52s (oportunidad)`, direction: 'bullish' });
      else if (d.priceVs52wHigh > -5)
        votes.push({ name: `Cerca de max 52s (${d.priceVs52wHigh.toFixed(0)}%)`, direction: 'bearish' });
    }

    // F5. Posición vs mínimo 52 semanas
    if (d.priceVs52wLow != null) {
      if (d.priceVs52wLow < 10)
        votes.push({ name: `Cerca de min 52s (+${d.priceVs52wLow.toFixed(0)}%)`, direction: 'bearish' });
      else if (d.priceVs52wLow > 50)
        votes.push({ name: `${d.priceVs52wLow.toFixed(0)}% arriba de min 52s`, direction: 'bullish' });
    }
  }

  // =====================================================
  // SENTIMENT VOTES (~3 señales independientes)
  // =====================================================
  const sentScore = sent?.score ?? 0;
  const sentScaled = sentScore * 100;

  // S1. Score general de sentimiento
  if (sentScaled > 15) votes.push({ name: `Sentimiento positivo (${sentScaled.toFixed(0)}%)`, direction: 'bullish' });
  else if (sentScaled < -15) votes.push({ name: `Sentimiento negativo (${sentScaled.toFixed(0)}%)`, direction: 'bearish' });
  else votes.push({ name: 'Sentimiento neutral', direction: 'neutral' });

  // S2. Volumen de noticias — muchas noticias amplifica la señal
  if (sent?.newsCount != null && sent.newsCount >= 3) {
    const posRatio = (sent.positiveCount ?? 0) / sent.newsCount;
    const negRatio = (sent.negativeCount ?? 0) / sent.newsCount;
    if (posRatio >= 0.6)
      votes.push({ name: `${sent.positiveCount}/${sent.newsCount} noticias positivas`, direction: 'bullish' });
    else if (negRatio >= 0.6)
      votes.push({ name: `${sent.negativeCount}/${sent.newsCount} noticias negativas`, direction: 'bearish' });
  }

  // S3. Consenso fuerte — todas las noticias apuntan igual
  if (sent?.newsCount != null && sent.newsCount >= 2) {
    const neg = sent.negativeCount ?? 0;
    const pos = sent.positiveCount ?? 0;
    if (pos > 0 && neg === 0)
      votes.push({ name: `Consenso total positivo (${pos} noticias)`, direction: 'bullish' });
    else if (neg > 0 && pos === 0)
      votes.push({ name: `Consenso total negativo (${neg} noticias)`, direction: 'bearish' });
  }

  // --- Calculate confluence ---
  const bullish = votes.filter((v) => v.direction === 'bullish');
  const bearish = votes.filter((v) => v.direction === 'bearish');
  const neutral = votes.filter((v) => v.direction === 'neutral');

  const totalDirectional = bullish.length + bearish.length;
  if (totalDirectional === 0) {
    return {
      bullishSignals: [],
      bearishSignals: [],
      neutralSignals: neutral.map((v) => v.name),
      confluencePercent: 30,
      direction: 'mixed',
    };
  }

  const dominant = bullish.length >= bearish.length ? 'bullish' : 'bearish';
  const dominantCount = dominant === 'bullish' ? bullish.length : bearish.length;

  // Coverage-aware confidence: thin/single-axis data is capped so it can't report 95%.
  const axesWithData = (tech ? 1 : 0) + (fund ? 1 : 0) + (sent ? 1 : 0);
  const confluencePercent = computeConfluencePercent(dominantCount, votes.length, axesWithData);

  return {
    bullishSignals: bullish.map((v) => v.name),
    bearishSignals: bearish.map((v) => v.name),
    neutralSignals: neutral.map((v) => v.name),
    confluencePercent,
    direction: dominant,
  };
}

/** Legacy wrapper — returns simple confidence number */
export function computeConfidence(
  _techScore: number,
  _fundScore: number,
  _sentScore: number,
  tech?: TechnicalSummary,
  fund?: FundamentalSummary,
  sent?: SentimentInput,
): number {
  const detail = computeConfluence(tech, fund, sent);
  return detail.confluencePercent;
}

/** Full confluence detail for enriched opportunities */
export function computeConfluenceDetail(
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: SentimentInput | undefined,
): ConfluenceDetail {
  return computeConfluence(tech, fund, sent);
}

// --- Action ---

/**
 * Score → Action (ajustado para swing trader táctico).
 * Más agresivo que un inversor conservador: SELL antes, BUY requiere más confirmación.
 *
 * hasConflicts penaliza en TODOS los rangos, no solo en el tier STRONG:
 * - Score 72+ sin conflictos → BUY (STRONG tier)
 * - Score 72+ con conflictos → WATCH (conflicto sería grave, señales contradictorias)
 * - Score 62-71 sin conflictos → BUY
 * - Score 62-71 con conflictos → WATCH (no entrar cuando hay contradicción)
 */
export function scoreToAction(score: number, inPortfolio: boolean, confidence?: number, hasConflicts?: boolean): SignalAction {
  const T = ACTION_THRESHOLDS;
  if (score >= T.strongBuy.minScore && (confidence ?? 0) >= T.strongBuy.minConfidence && !hasConflicts) return 'BUY'; // STRONG BUY tier
  if (score >= T.strongBuy.minScore) return hasConflicts ? 'WATCH' : 'BUY';
  if (score >= T.buy.minScore) return hasConflicts ? 'WATCH' : 'BUY';
  if (score >= T.hold.minScore && inPortfolio) return 'HOLD';
  if (score >= T.holdWeak.minScore) return inPortfolio ? 'HOLD' : 'WATCH';
  return inPortfolio ? 'SELL' : 'WATCH'; // <42 en portfolio = SELL
}

export function getConvictionTier(score: number, confidence: number, hasConflicts: boolean, hasBullishDivergence: boolean): ConvictionTier {
  if (score >= 72 && confidence >= 70 && !hasConflicts) return 'strong';
  if (score >= 52 && score < 62 && hasBullishDivergence) return 'speculative';
  return 'standard';
}

/**
 * Smart action that considers divergences, trade levels, and portfolio context.
 * This OVERRIDES the basic scoreToAction when there's a strong anticipatory signal.
 */
function smartAction(
  baseAction: SignalAction,
  composite: number,
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  tradeLevels: TradeLevels | undefined,
  inPortfolio: boolean,
  symbol: string,
): { action: SignalAction; reason?: string } {
  const divergences = tech?.divergences ?? [];
  const weeklyDivs = divergences.filter(d => d.timeframe === 'weekly');
  const dailyDivs = divergences.filter(d => d.timeframe === 'daily');
  const price = tech?.indicators.currentPrice ?? 0;

  if (!price || price <= 0) return { action: baseAction };

  const p = (v: number) => `$${v.toFixed(2)}`;

  // Count bearish/bullish signals across both timeframes
  const bearishWeekly = weeklyDivs.filter(d => d.type === 'bearish');
  const bearishDaily = dailyDivs.filter(d => d.type === 'bearish');
  const bullishWeekly = weeklyDivs.filter(d => d.type === 'bullish');
  const bullishDaily = dailyDivs.filter(d => d.type === 'bullish');

  // === PORTFOLIO: anticipar caída ===
  if (inPortfolio && tradeLevels) {
    const distToStop = ((price - tradeLevels.stopLoss) / price) * 100;
    const allBearishIndicators = [...bearishWeekly, ...bearishDaily].map(d => `${d.indicator.toUpperCase()} (${d.timeframe === 'weekly' ? 'semanal' : 'diario'})`);

    // Precio cerca del stop (< 5%) + cualquier divergencia bajista → SELL anticipado
    if (distToStop < 5 && (bearishWeekly.length > 0 || bearishDaily.length >= 2)) {
      return {
        action: 'SELL',
        reason: `Tenes ${symbol} a ${p(price)} y el stop esta en ${p(tradeLevels.stopLoss)} (a solo ${distToStop.toFixed(1)}%). Las divergencias bajistas en ${allBearishIndicators.join(' + ')} dicen que va a seguir cayendo — mejor salir ahora y proteger capital.`,
      };
    }

    // Divergencia bajista semanal fuerte (RSI + MACD ambas bajistas) → SELL
    if (bearishWeekly.length >= 2) {
      return {
        action: 'SELL',
        reason: `${symbol} tiene divergencia bajista en ${allBearishIndicators.join(' y ')} en velas semanales — el precio sube pero los indicadores no acompanian. Esto anticipa una correccion. Con el stop en ${p(tradeLevels.stopLoss)}, mejor vender ahora a ${p(price)}.`,
      };
    }

    // 2+ divergencias bajistas diarias en portfolio → SELL (swing trader: anticipar corrección)
    // No importa el RSI ni el score — si RSI y MACD ambos divergen bajista, hay que salir
    const rsi = tech?.indicators.rsi14;
    if (bearishDaily.length >= 2) {
      const rsiNote = rsi != null && rsi > 60 ? ` con RSI en ${rsi.toFixed(0)} (zona alta)` : '';
      const weeklyRSI = tech?.weekly?.rsi14;
      const weeklyNote = weeklyRSI != null && weeklyRSI > 60 ? ` RSI semanal en ${weeklyRSI.toFixed(0)}.` : '';
      return {
        action: 'SELL',
        reason: `${symbol} a ${p(price)} tiene ${bearishDaily.length} divergencias bajistas diarias (${allBearishIndicators.join(' + ')})${rsiNote}.${weeklyNote} El precio esta en maximos pero los indicadores pierden fuerza — esto anticipa una correccion. Para tu perfil de swing trader, vender ahora para proteger ganancia y recomprar cuando corrija al soporte en ${p(tradeLevels.stopLoss)}.`,
      };
    }

    // 1 divergencia bajista semanal + score bajo → SELL
    if (bearishWeekly.length > 0 && composite < 55) {
      return {
        action: 'SELL',
        reason: `${symbol} a ${p(price)} muestra divergencia bajista semanal y score debil (${composite}/100). Las seniales dicen que va a caer — reducir posicion.`,
      };
    }

    // 1 divergencia bajista diaria + RSI alto → SELL (threshold adapta a volatilidad del activo)
    const beta = fund?.data.beta ?? 1;
    const rsiSellThreshold = beta > 1.5 ? 70 : 60; // high-beta stocks: RSI 70, normal: RSI 60
    if (bearishDaily.length >= 1 && rsi != null && rsi > rsiSellThreshold) {
      return {
        action: 'SELL',
        reason: `${symbol} tiene divergencia bajista diaria (${allBearishIndicators.join(', ')}) con RSI en ${rsi.toFixed(0)}${beta > 1.5 ? ` (umbral ${rsiSellThreshold} por beta alta ${beta.toFixed(1)})` : ''}. El momentum pierde fuerza en zona alta — vender para proteger ganancia antes de que corrija.`,
      };
    }

    // 1 divergencia bajista diaria + precio cayendo (bajo SMA20) → SELL
    if (bearishDaily.length >= 1 && tech?.indicators.priceVsSma20 != null && tech.indicators.priceVsSma20 < -2) {
      return {
        action: 'SELL',
        reason: `${symbol} tiene divergencia bajista diaria y el precio ya esta ${Math.abs(tech.indicators.priceVsSma20).toFixed(1)}% debajo de la media de 20 dias. La correccion ya empezo — vender para proteger capital.`,
      };
    }
  }

  // === NO EN PORTFOLIO: anticipar movimiento ===
  if (!inPortfolio && tradeLevels) {
    const marginToTarget = ((tradeLevels.takeProfit - price) / price) * 100;
    const rr = tradeLevels.riskRewardRatio;
    const bullishIndicators = [...bullishWeekly, ...bullishDaily].map(d => `${d.indicator.toUpperCase()} (${d.timeframe === 'weekly' ? 'semanal' : 'diario'})`);
    const bearishIndicators = [...bearishWeekly, ...bearishDaily].map(d => `${d.indicator.toUpperCase()} (${d.timeframe === 'weekly' ? 'semanal' : 'diario'})`);

    // Cualquier divergencia bajista + BUY → bajar a WATCH (no comprar con div bajista)
    if ((bearishDaily.length > 0 || bearishWeekly.length > 0) && (baseAction === 'BUY' || baseAction === 'HOLD')) {
      return {
        action: 'WATCH',
        reason: `${symbol} tiene divergencias bajistas (${bearishIndicators.join(' + ')}) que anticipan una correccion. NO es momento de entrar. Esperar a que corrija y entrar a mejor precio. Vigilar soporte en ${p(tradeLevels.stopLoss)}.`,
      };
    }

    // Divergencia alcista semanal + buen R/R → BUY
    if (bullishWeekly.length > 0 && rr >= 1.5 && marginToTarget > 10) {
      return {
        action: 'BUY',
        reason: `${symbol} a ${p(price)} tiene divergencia alcista semanal en ${bullishIndicators.join(' + ')} — el precio esta bajo pero los indicadores muestran que esta por rebotar. Con target en ${p(tradeLevels.takeProfit)} (+${marginToTarget.toFixed(0)}%) y stop en ${p(tradeLevels.stopLoss)}, R/R 1:${rr.toFixed(1)}.`,
      };
    }

    // Divergencia alcista semanal + WATCH → BUY
    if (bullishWeekly.length > 0 && composite >= 45 && baseAction === 'WATCH') {
      return {
        action: 'BUY',
        reason: `${symbol} estaba para observar, pero la divergencia alcista semanal en ${bullishIndicators.join(' + ')} cambia el panorama. El precio cae pero el momentum frena — es el momento de comprar antes de que rebote.`,
      };
    }

    // 2+ divergencias alcistas diarias + score moderado + WATCH → BUY (anticipo)
    if (bullishDaily.length >= 2 && composite >= 50 && baseAction === 'WATCH' && rr >= 1.5) {
      return {
        action: 'BUY',
        reason: `${symbol} tiene ${bullishDaily.length} divergencias alcistas diarias (${bullishIndicators.join(' + ')}) — los indicadores anticipan un rebote aunque el precio siga bajo. Con R/R de 1:${rr.toFixed(1)}, buen momento para anticiparse.`,
      };
    }
  }

  // === EN PORTFOLIO: divergencia alcista → comprar más ===
  if (inPortfolio && baseAction === 'HOLD') {
    const bullishIndicators = [...bullishWeekly, ...bullishDaily].map(d => `${d.indicator.toUpperCase()} (${d.timeframe === 'weekly' ? 'semanal' : 'diario'})`);

    if (bullishWeekly.length > 0 && tradeLevels && tradeLevels.riskRewardRatio >= 2) {
      const marginToTarget = ((tradeLevels.takeProfit - price) / price) * 100;
      return {
        action: 'BUY',
        reason: `Ya tenes ${symbol} y tiene divergencia alcista semanal en ${bullishIndicators.join(' + ')} — el precio corrigio pero el momentum dice que va a rebotar. Con target +${marginToTarget.toFixed(0)}% y R/R 1:${tradeLevels.riskRewardRatio.toFixed(1)}, buen momento para comprar mas.`,
      };
    }
  }

  // === TIMING vs ACTION: si el timing con alta confianza contradice la acción final, degradar ===
  // Fix: timing.action era calculado pero completamente ignorado en la decisión final.
  // Ahora: si timing.action = SELL con confianza >= 65% y acción base es BUY → bajar a WATCH.
  // Solo aplica fuera del portfolio (no queremos forzar ventas por timing solo).
  if (!inPortfolio && tradeLevels) {
    const timingSignal = tech?.timing;
    if (timingSignal && timingSignal.confidence >= 65) {
      if (timingSignal.action === 'SELL' && (baseAction === 'BUY' || baseAction === 'HOLD')) {
        const sellTriggerDescriptions = timingSignal.triggers
          .filter(t => t.description.includes('bajista') || t.description.includes('sobrecompra') || t.description.includes('venta') || t.description.includes('Death Cross'))
          .map(t => t.description)
          .slice(0, 2)
          .join('; ');
        return {
          action: 'WATCH',
          reason: `El análisis de timing detecta señales de venta con ${timingSignal.confidence}% de confianza (${sellTriggerDescriptions || 'múltiples triggers bajistas'}), lo que contradice la señal de compra del score combinado. El timing y el score van en direcciones opuestas: esperar confirmación antes de entrar.`,
        };
      }
      // Si timing dice BUY con alta confianza y base es WATCH, y hay buen R/R → considerar subir
      if (timingSignal.action === 'BUY' && timingSignal.confidence >= 75 && baseAction === 'WATCH' && composite >= 48) {
        const buyTriggerDescriptions = timingSignal.triggers
          .filter(t => t.description.includes('alcista') || t.description.includes('sobreventa') || t.description.includes('compra') || t.description.includes('Golden Cross'))
          .map(t => t.description)
          .slice(0, 2)
          .join('; ');
        const rr = tradeLevels.riskRewardRatio;
        if (rr >= 1.5) {
          return {
            action: 'BUY',
            reason: `El timing detecta señales de entrada con ${timingSignal.confidence}% de confianza (${buyTriggerDescriptions || 'múltiples triggers alcistas'}) y R/R 1:${rr.toFixed(1)}. El análisis de timing eleva la señal de observar a comprar.`,
          };
        }
      }
    }
  }

  return { action: baseAction };
}

/** Technical-only action — uses raw tech score (-100..+100). Swing trader thresholds. */
export function techScoreToAction(techScore: number, inPortfolio: boolean): SignalAction {
  if (techScore > 15) return 'BUY';
  if (techScore >= -5) return inPortfolio ? 'HOLD' : 'WATCH';
  return inPortfolio ? 'SELL' : 'WATCH'; // <-5 con portfolio = SELL técnico
}

/** Fundamental-only action — uses raw fund score (-100..+100) */
export function fundScoreToAction(fundScore: number, inPortfolio: boolean): SignalAction {
  if (fundScore > 10) return 'BUY';
  if (fundScore >= -10) return inPortfolio ? 'HOLD' : 'WATCH';
  return inPortfolio ? 'SELL' : 'WATCH';
}

/** Sentiment-only action — uses raw sent score (-1..+1) */
export function sentScoreToAction(sentScore: number, inPortfolio: boolean): SignalAction {
  if (sentScore > 0.15) return 'BUY';
  if (sentScore >= -0.15) return inPortfolio ? 'HOLD' : 'WATCH';
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
  'etfs-sectors': 'etfs-sectors',
  commodities: 'commodities',
  'emerging-markets': 'emerging-markets',
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

    const sector = getSectorForSymbolDynamic(symbol);
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
  mode: 'strict' | 'relaxed';
}

export function applyAntiHypeFilters(
  symbols: string[],
  techMap: Map<string, TechnicalSummary>,
  portfolioSymbols: Set<string>,
  options?: { includeVolume?: boolean; newsImpactBypass?: Set<string> },
): AntiHypeFilterResult {
  const includeVolume = options?.includeVolume ?? true;
  const newsImpactBypass = options?.newsImpactBypass ?? new Set<string>();
  const filtered: string[] = [];
  const rejected: Array<{ symbol: string; reasons: string[] }> = [];
  const MAX_FAILURES = 1; // pass with 2 of 3 (or 2 of 2 without volume)

  for (const symbol of symbols) {
    // Portfolio symbols always pass (for SELL signals)
    if (portfolioSymbols.has(symbol)) {
      filtered.push(symbol);
      continue;
    }

    // Symbols mentioned in HIGH-impact recent news bypass anti-hype.
    // Reason: bonds/commodities can be below SMA200 structurally (bear regime) but
    // still be relevant when news triggers a reversal. We want the LLM to see them.
    if (newsImpactBypass.has(symbol)) {
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

    // Filter 2: RSI < 85 (solo filtrar sobrecompra extrema — sobreventa es oportunidad swing)
    if (ind.rsi14 != null && ind.rsi14 > 85) {
      reasons.push(`RSI ${ind.rsi14.toFixed(0)} en sobrecompra extrema (>85)`);
    }

    // Filter 3: Volume > 100% of 20-day average (optional)
    if (includeVolume && ind.volumeRatio < 1.0) {
      reasons.push(`Volumen ratio ${ind.volumeRatio.toFixed(2)}x < 1.0x`);
    }

    if (reasons.length <= MAX_FAILURES) {
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
    mode: includeVolume ? 'strict' : 'relaxed',
  };
}

// --- Return estimates ---

/**
 * Estimate short-term return (1-4 weeks).
 * Weights: Technical 50%, Sentiment 35%, Fundamental 15%
 * Uses RSI mean-reversion, distance to SMA20, Bollinger position, volume, and sentiment.
 */
function estimateShortTermReturn(
  tech: TechnicalSummary | undefined,
  sent: SentimentInput | undefined,
  fund: FundamentalSummary | undefined,
  shortTermScore: number,
  catalysts: string[],
): ReturnEstimate {
  const ind = tech?.indicators;
  const distToSma20 = ind?.priceVsSma20 ?? 0;
  const rsi = ind?.rsi14 ?? 50;
  const volRatio = ind?.volumeRatio ?? 1;
  const sentScore = sent?.score ?? 0;

  // Technical component: RSI mean-reversion + SMA20 distance
  const rsiComponent = rsi < 30 ? 6 : rsi < 40 ? 3 : rsi > 70 ? -5 : rsi > 60 ? -2 : 0;
  const smaComponent = Math.round(-distToSma20 * 0.3); // if below SMA20, positive return expected
  const techBase = Math.max(-8, Math.min(12, rsiComponent + smaComponent));

  // Sentiment component
  const sentComponent = Math.round(sentScore * 5); // -5 to +5

  // Fundamental minor component
  const fundComponent = (fund?.score ?? 0) > 15 ? 2 : (fund?.score ?? 0) < -15 ? -1 : 0;

  // Weighted base
  let base = Math.round(techBase * 0.5 + sentComponent * 0.35 + fundComponent * 0.15);
  base = Math.max(-8, Math.min(15, base));

  // Volatility adjustment: high volume = wider range
  const volSpread = volRatio > 2 ? 1.5 : volRatio > 1.5 ? 1.2 : 1;
  const lowSpread = Math.round(4 * volSpread);
  const highSpread = Math.round(6 * volSpread);

  // Confidence based on data alignment
  const hasGoodData = ind?.rsi14 != null && ind?.sma20 != null;
  const confidence = !hasGoodData ? 35
    : shortTermScore > 60 ? 70
    : shortTermScore > 50 ? 55
    : 40;

  // Key drivers
  const drivers: string[] = [];
  if (rsiComponent !== 0) drivers.push(`RSI ${rsi.toFixed(0)} ${rsiComponent > 0 ? 'sugiere rebote' : 'indica sobrecompra'}`);
  if (Math.abs(distToSma20) > 3) drivers.push(`${Math.abs(distToSma20).toFixed(1)}% ${distToSma20 < 0 ? 'debajo' : 'arriba'} de SMA20`);
  if (sentScore > 0.2) drivers.push('Sentimiento positivo impulsa');
  else if (sentScore < -0.2) drivers.push('Sentimiento negativo presiona');
  if (drivers.length === 0) drivers.push(...catalysts.slice(0, 2));

  return {
    lowPercent: base - lowSpread,
    midPercent: base,
    highPercent: base + highSpread,
    confidence,
    keyDrivers: drivers.slice(0, 2),
  };
}

/**
 * Estimate medium-term return (1-6 months).
 * Weights: Fundamental 45%, Technical 30%, Sentiment 25%
 * Uses SMA50/SMA200 distance, P/E vs Forward P/E, 52w range, and sentiment trend.
 */
function estimateMediumTermReturn(
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: SentimentInput | undefined,
  mediumTermScore: number,
): ReturnEstimate {
  const ind = tech?.indicators;
  const distToSma50 = ind?.priceVsSma50 ?? 0;
  const distToSma200 = ind?.priceVsSma200 ?? 0;
  const fundScore = fund?.score ?? 0;
  const sentScore = sent?.score ?? 0;

  // Fundamental component: P/E compression, 52w range, dividend
  let fundComponent = 0;
  const pe = fund?.data.peRatio;
  const fpe = fund?.data.forwardPE;
  if (fpe != null && pe != null && fpe < pe) {
    fundComponent += Math.round(((pe - fpe) / pe) * 20); // earnings growth implied
  }
  if (fund?.data.priceVs52wHigh != null && fund.data.priceVs52wHigh < -30) {
    fundComponent += 5; // far from 52w high = upside potential
  }
  if (fund?.data.dividendYield != null && fund.data.dividendYield > 0.03) {
    fundComponent += 2; // good dividend adds return
  }
  fundComponent += fundScore > 20 ? 5 : fundScore < -20 ? -5 : 0;
  fundComponent = Math.max(-10, Math.min(20, fundComponent));

  // Technical component: mean reversion to SMA50/SMA200
  const sma50Component = Math.round(-distToSma50 * 0.3);
  const sma200Component = distToSma200 < -10 ? 5 : distToSma200 > 20 ? -3 : 0;
  const techComponent = Math.max(-8, Math.min(12, sma50Component + sma200Component));

  // Sentiment component
  const sentComponent = Math.round(sentScore * 8); // -8 to +8

  // Weighted base
  let base = Math.round(fundComponent * 0.45 + techComponent * 0.30 + sentComponent * 0.25);
  base = Math.max(-15, Math.min(30, base));

  // Wider range for medium-term
  const lowSpread = 8;
  const highSpread = 15;

  // Confidence
  const hasGoodData = pe != null || (ind?.sma50 != null && ind?.sma200 != null);
  const confidence = !hasGoodData ? 30
    : mediumTermScore > 60 ? 65
    : mediumTermScore > 50 ? 50
    : 35;

  // Key drivers
  const drivers: string[] = [];
  if (fpe != null && pe != null && fpe < pe) {
    drivers.push(`Forward P/E ${fpe.toFixed(1)} vs ${pe.toFixed(1)} implica crecimiento`);
  }
  if (Math.abs(distToSma50) > 5) {
    drivers.push(`${Math.abs(distToSma50).toFixed(0)}% ${distToSma50 < 0 ? 'debajo' : 'arriba'} de SMA50`);
  }
  if (fund?.data.priceVs52wHigh != null && fund.data.priceVs52wHigh < -20) {
    drivers.push(`${Math.abs(fund.data.priceVs52wHigh).toFixed(0)}% debajo de maximo 52 semanas`);
  }
  if (sentScore > 0.2) drivers.push('Tendencia de sentimiento positiva');
  else if (sentScore < -0.2) drivers.push('Presion negativa en noticias');
  if (drivers.length === 0) {
    drivers.push(fundScore > 0 ? 'Fundamentales soportan upside' : 'Sin catalizador fundamental claro');
  }

  return {
    lowPercent: base - lowSpread,
    midPercent: base,
    highPercent: base + highSpread,
    confidence,
    keyDrivers: drivers.slice(0, 2),
  };
}

// --- Build opportunity completa ---

export interface SentimentInput {
  score: number; // -1..+1
  sentiment: SentimentType;
  headlines: string[];
  newsCount?: number;
  positiveCount?: number;
  negativeCount?: number;
  neutralCount?: number;
}

function buildSimpleReasoning(
  action: SignalAction,
  score: number,
  confidence: number,
  confluence: ConfluenceDetail,
  techScore: number,
  fundScore: number,
  sentScaled: number,
  rsi: number | null | undefined,
  pe: number | null | undefined,
  distToSma50: number,
  inPortfolio: boolean,
): string {
  const confLabel = confidence >= 70 ? 'con alta confianza' : confidence >= 50 ? 'con confianza moderada' : 'con baja confianza';
  const bull = confluence.bullishSignals.length;
  const bear = confluence.bearishSignals.length;

  // --- BUY ---
  if (action === 'BUY') {
    if (rsi != null && rsi < 35 && techScore > 0)
      return `Precio castigado con senales de recuperacion. Buen momento para entrar ${confLabel}. ${bull} de ${bull + bear} indicadores a favor.`;
    if (fundScore > 15 && techScore > 0)
      return `Precio atractivo y con buen impulso. Oportunidad de compra ${confLabel}. ${bull} de ${bull + bear} indicadores a favor.`;
    if (sentScaled > 20 && techScore > 0)
      return `Noticias positivas y tendencia alcista. Buena oportunidad ${confLabel}. ${bull} de ${bull + bear} indicadores a favor.`;
    return `Multiples senales positivas alineadas. Oportunidad de compra ${confLabel}. ${bull} de ${bull + bear} indicadores a favor.`;
  }

  // --- SELL ---
  if (action === 'SELL') {
    if (rsi != null && rsi > 70)
      return `Precio en zona alta, posible caida proxima. Considerar vender ${confLabel}. ${bear} de ${bull + bear} indicadores en contra.`;
    if (techScore < -20)
      return `Tendencia negativa. Mejor salir y proteger capital ${confLabel}. ${bear} de ${bull + bear} indicadores en contra.`;
    if (sentScaled < -20)
      return `Noticias negativas presionan el precio. Considerar reducir posicion ${confLabel}.`;
    return `Senales negativas predominan. Considerar vender ${confLabel}. ${bear} de ${bull + bear} indicadores en contra.`;
  }

  // --- HOLD ---
  if (action === 'HOLD') {
    if (score >= 55)
      return `Andando bien. Mantener y seguir de cerca ${confLabel}. ${bull} a favor vs ${bear} en contra.`;
    if (distToSma50 > 0)
      return `Todavia en tendencia positiva pero sin fuerza clara. Mantener por ahora ${confLabel}.`;
    return `Sin senal clara para comprar mas ni para vender. Mantener ${confLabel}. ${bull} a favor vs ${bear} en contra.`;
  }

  // --- WATCH ---
  if (score >= 55)
    return `Interesante pero todavia no es momento de entrar. Seguir de cerca ${confLabel}. ${bull} a favor vs ${bear} en contra.`;
  if (rsi != null && rsi < 40 && techScore > 0)
    return `Precio bajo con potencial de rebote. Puede ser buena entrada pronto ${confLabel}.`;
  if (confluence.direction === 'mixed')
    return `Senales mixtas, no hay direccion clara. Esperar mejor momento. ${bull} a favor vs ${bear} en contra.`;
  return `Potencial pero necesita confirmacion. Observar antes de actuar ${confLabel}. ${bull} a favor vs ${bear} en contra.`;
}

// --- Trade Levels (entry / stop-loss / take-profit) ---

export function computeTradeLevels(
  tech: TechnicalSummary | undefined,
  action: SignalAction,
  portfolioValue?: number,
  existingQuantity?: number,
): TradeLevels | undefined {
  const ind = tech?.indicators;
  if (!ind || ind.currentPrice <= 0) return undefined;

  const price = ind.currentPrice;
  const atr = ind.atr14 ?? price * 0.03; // fallback 3% si no hay ATR
  const supports = ind.supports ?? [];
  const resistances = ind.resistances ?? [];

  // Clamp de riesgo: un "soporte" de un chart roto (reverse split, colapso tipo SDOT) puede
  // quedar a -90% del entry. El stop NUNCA queda más lejos que MAX_STOP_ATR_MULT x ATR,
  // sea cual sea lo que diga el clustering de soportes/resistencias.
  const MAX_STOP_ATR_MULT = 3;
  const maxStopDistance = atr * MAX_STOP_ATR_MULT;

  let entryPrice: number;
  let stopLoss: number;
  let takeProfit: number;
  let entryReason: string;
  let stopReason: string;
  let targetReason: string;

  if (action === 'BUY' || action === 'WATCH') {
    // Entry: precio actual o soporte cercano (el que sea mas bajo)
    const nearestSupport = supports[0];
    if (nearestSupport && nearestSupport.price < price && (price - nearestSupport.price) / price < 0.05) {
      entryPrice = Math.round(nearestSupport.price * 100) / 100;
      entryReason = `Soporte en $${entryPrice.toFixed(2)} (${nearestSupport.touches} toques)`;
    } else {
      entryPrice = Math.round(price * 100) / 100;
      entryReason = 'Precio actual de mercado';
    }

    // Stop: debajo del soporte mas fuerte o 1.5x ATR debajo de entry
    const strongSupport = supports.find(s => s.price < entryPrice);
    if (strongSupport) {
      stopLoss = Math.round((strongSupport.price - atr * 0.3) * 100) / 100;
      stopReason = `Debajo de soporte $${strongSupport.price.toFixed(2)} - margen ATR`;
    } else {
      stopLoss = Math.round((entryPrice - atr * 1.5) * 100) / 100;
      stopReason = `1.5x ATR ($${atr.toFixed(2)}) debajo de entrada`;
    }

    if (entryPrice - stopLoss > maxStopDistance) {
      stopLoss = Math.round((entryPrice - maxStopDistance) * 100) / 100;
      stopReason = `Clamp: stop estructural demasiado lejano — ajustado a ${MAX_STOP_ATR_MULT}x ATR ($${atr.toFixed(2)})`;
    }

    // Target: buscar resistencia que de un R/R minimo de 1.5
    const risk = Math.abs(entryPrice - stopLoss);
    const minTarget = entryPrice + risk * 1.5; // minimo 1.5:1 R/R
    const atrTarget = entryPrice + atr * 2.5;
    const minRequired = Math.max(minTarget, atrTarget); // el mayor de ambos

    // Buscar la mejor resistencia: que esté por encima del minimo requerido
    const goodResistance = resistances.find(r => r.price >= minRequired);
    const nearestResistance = resistances[0];

    if (goodResistance && goodResistance.price > entryPrice) {
      takeProfit = Math.round(goodResistance.price * 100) / 100;
      targetReason = `Resistencia en $${takeProfit.toFixed(2)} (${goodResistance.touches} toques, R/R favorable)`;
    } else if (nearestResistance && nearestResistance.price >= minRequired) {
      takeProfit = Math.round(nearestResistance.price * 100) / 100;
      targetReason = `Resistencia en $${takeProfit.toFixed(2)} (${nearestResistance.touches} toques)`;
    } else {
      // No hay resistencia con buen R/R — usar ATR como target
      takeProfit = Math.round(minRequired * 100) / 100;
      targetReason = nearestResistance
        ? `Resistencia cercana en $${nearestResistance.price.toFixed(2)} es muy baja — target ajustado a $${takeProfit.toFixed(2)} (1.5x riesgo minimo)`
        : `2.5x ATR ($${atr.toFixed(2)}) arriba de entrada`;
    }
  } else if (action === 'SELL') {
    // Para SELL: inverso
    entryPrice = Math.round(price * 100) / 100;
    entryReason = 'Vender a precio actual';

    const nearestResistance = resistances[0];
    if (nearestResistance && nearestResistance.price > price) {
      stopLoss = Math.round((nearestResistance.price + atr * 0.3) * 100) / 100;
      stopReason = `Arriba de resistencia $${nearestResistance.price.toFixed(2)} - margen ATR`;
    } else {
      stopLoss = Math.round((price + atr * 1.5) * 100) / 100;
      stopReason = `1.5x ATR arriba (para cortar perdida si sube)`;
    }

    if (stopLoss - entryPrice > maxStopDistance) {
      stopLoss = Math.round((entryPrice + maxStopDistance) * 100) / 100;
      stopReason = `Clamp: stop estructural demasiado lejano — ajustado a ${MAX_STOP_ATR_MULT}x ATR ($${atr.toFixed(2)})`;
    }

    // Target: buscar soporte que de buen R/R
    const sellRisk = Math.abs(stopLoss - entryPrice);
    const sellMinTarget = entryPrice - sellRisk * 1.5;
    const sellAtrTarget = entryPrice - atr * 2.5;
    const sellMinRequired = Math.min(sellMinTarget, sellAtrTarget);

    const goodSupport = supports.find(s => s.price <= sellMinRequired);
    const nearestSupport = supports[0];

    if (goodSupport && goodSupport.price < entryPrice) {
      takeProfit = Math.round(goodSupport.price * 100) / 100;
      targetReason = `Soporte en $${takeProfit.toFixed(2)} (${goodSupport.touches} toques, R/R favorable)`;
    } else if (nearestSupport && nearestSupport.price <= sellMinRequired) {
      takeProfit = Math.round(nearestSupport.price * 100) / 100;
      targetReason = `Soporte en $${takeProfit.toFixed(2)} (objetivo de caida)`;
    } else {
      takeProfit = Math.round(sellMinRequired * 100) / 100;
      targetReason = nearestSupport
        ? `Soporte cercano en $${nearestSupport.price.toFixed(2)} es muy alto — target ajustado a $${takeProfit.toFixed(2)} (1.5x riesgo minimo)`
        : `2.5x ATR debajo de precio actual`;
    }
  } else {
    // HOLD: niveles informativos
    entryPrice = Math.round(price * 100) / 100;
    entryReason = 'Precio actual (ya en portfolio)';
    stopLoss = supports[0]
      ? Math.round((supports[0].price - atr * 0.3) * 100) / 100
      : Math.round((price - atr * 1.5) * 100) / 100;
    stopReason = supports[0]
      ? `Debajo de soporte $${supports[0].price.toFixed(2)}`
      : `1.5x ATR debajo de precio actual`;

    if (entryPrice - stopLoss > maxStopDistance) {
      stopLoss = Math.round((entryPrice - maxStopDistance) * 100) / 100;
      stopReason = `Clamp: stop estructural demasiado lejano — ajustado a ${MAX_STOP_ATR_MULT}x ATR ($${atr.toFixed(2)})`;
    }

    takeProfit = resistances[0]
      ? Math.round(resistances[0].price * 100) / 100
      : Math.round((price + atr * 2.5) * 100) / 100;
    targetReason = resistances[0]
      ? `Resistencia en $${resistances[0].price.toFixed(2)}`
      : `2.5x ATR arriba de precio actual`;
  }

  // Validaciones de seguridad
  if (stopLoss <= 0) stopLoss = Math.round(entryPrice * 0.92 * 100) / 100;
  if (takeProfit <= entryPrice && action !== 'SELL') takeProfit = Math.round(entryPrice * 1.08 * 100) / 100;
  if (takeProfit >= entryPrice && action === 'SELL') takeProfit = Math.round(entryPrice * 0.92 * 100) / 100;

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  const riskRewardRatio = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

  // Setup inválido: si aún clampeado (MAX_STOP_ATR_MULT x ATR) el riesgo excede el % máximo
  // del precio de entrada, el trade no es operable — degradar la acción en el caller.
  // Ambas protecciones aplican EN SERIE: el clamp acota el stop, y el cap de riesgo marca
  // invalid lo que sigue siendo inoperable. Un setup que arriesga >10% del precio por trade
  // no es swing trading — con volatilidad extrema (ATR ≳ 3.3% del precio) el stop clampeado
  // a 3x ATR ya supera el 10% y el setup queda invalid aunque el clamp haya actuado.
  const MAX_SETUP_RISK_PCT = envNumber('MAX_SETUP_RISK_PCT', 10); // % del entry
  const riskPct = entryPrice > 0 ? (risk / entryPrice) * 100 : 0;
  const setupQuality: 'valid' | 'invalid' = riskPct > MAX_SETUP_RISK_PCT ? 'invalid' : 'valid';
  const setupWarning = setupQuality === 'invalid'
    ? `riesgo del setup ${riskPct.toFixed(1)}% > máximo ${MAX_SETUP_RISK_PCT}% — no operar`
    : undefined;

  // Position sizing basado en portfolio value y risk/reward
  let suggestedQuantity: number | undefined;
  let suggestedAmount: number | undefined;
  let sizingReason: string | undefined;

  if (setupQuality === 'invalid') {
    // Sin sizing: recomendar cantidad sobre un setup no operable es contradictorio.
    sizingReason = 'Sin sizing sugerido: setup inválido (riesgo excede el máximo)';
    // suggestedQuantity/suggestedAmount quedan undefined
  } else if (portfolioValue && portfolioValue > 0 && (action === 'BUY' || action === 'WATCH') && entryPrice > 0) {
    // Max 20% del portfolio por activo, ajustado por R/R
    const maxPct = riskRewardRatio >= 2 ? 0.20 : riskRewardRatio >= 1 ? 0.10 : 0;
    if (maxPct > 0) {
      let maxAmount = portfolioValue * maxPct;
      // Descontar lo que ya tiene
      if (existingQuantity && existingQuantity > 0) {
        const existingValue = existingQuantity * entryPrice;
        maxAmount = Math.max(0, maxAmount - existingValue);
      }
      if (maxAmount > 0) {
        suggestedQuantity = Math.floor(maxAmount / entryPrice);
        suggestedAmount = Math.round(suggestedQuantity * entryPrice);
        const pctLabel = (maxPct * 100).toFixed(0);
        sizingReason = existingQuantity && existingQuantity > 0
          ? `${pctLabel}% del portfolio ($${suggestedAmount.toLocaleString()}) a $${entryPrice.toFixed(2)} = ${suggestedQuantity} acciones (ya tenes ${existingQuantity})`
          : `${pctLabel}% del portfolio ($${suggestedAmount.toLocaleString()}) a $${entryPrice.toFixed(2)} = ${suggestedQuantity} acciones`;
      }
    }
  }

  return {
    entryPrice, stopLoss, takeProfit, riskRewardRatio,
    entryReason, stopReason, targetReason,
    suggestedQuantity, suggestedAmount, sizingReason,
    setupQuality, setupWarning,
  };
}

// --- Timing View (resumen de triggers para el frontend) ---

function buildTimingView(tech: TechnicalSummary | undefined): TimingView | undefined {
  const timing = tech?.timing;
  if (!timing || timing.triggers.length === 0) return undefined;

  return {
    action: timing.action,
    timing: timing.timing,
    confidence: timing.confidence,
    triggers: timing.triggers.map(t => ({
      type: t.type,
      description: t.description,
      direction: t.direction,
      estimatedDays: t.estimatedDays,
      impact: t.impact,
    })),
  };
}

// --- Action Condition: hasta cuándo mantener, cuándo re-evaluar, cuándo salir ---

function buildActionCondition(opp: Opportunity, tech: TechnicalSummary | undefined): ActionCondition | undefined {
  const price = opp.currentPrice;
  const levels = opp.tradeLevels;
  if (!price || !levels) return undefined;

  const divergences = tech?.divergences ?? [];
  const bearishDivs = divergences.filter(d => d.type === 'bearish');
  const bullishDivs = divergences.filter(d => d.type === 'bullish');
  const supports = tech?.indicators.supports ?? [];
  const p = (v: number) => `$${v.toFixed(2)}`;

  // Estimate days from timing triggers
  const divTriggers = tech?.timing?.triggers.filter(t =>
    t.type === 'rsi_divergence' || t.type === 'macd_divergence' || t.type === 'obv_divergence',
  ) ?? [];
  const estimatedDays = divTriggers.length > 0
    ? Math.max(...divTriggers.map(t => t.estimatedDays ?? 3))
    : undefined;

  // Nearest support for re-evaluation
  const nearestSupport = supports[0];

  if (opp.action === 'HOLD') {
    if (bearishDivs.length > 0) {
      const divNames = bearishDivs.map(d => `${d.indicator.toUpperCase()} ${d.timeframe === 'weekly' ? 'semanal' : 'diario'}`).join(' + ');
      return {
        holdUntil: `Hasta que las divergencias bajistas se resuelvan (${divNames}). Estimado ~${estimatedDays ?? 3} dias.`,
        reEvaluateAt: nearestSupport ? nearestSupport.price : undefined,
        reEvaluateReason: nearestSupport
          ? `Si corrige a ${p(nearestSupport.price)} (soporte con ${nearestSupport.touches} toques), re-evaluar como BUY.`
          : undefined,
        exitAt: levels.stopLoss,
        exitReason: `Si rompe ${p(levels.stopLoss)} → SELL inmediato, no esperar.`,
        estimatedDays: estimatedDays ?? 3,
      };
    }
    return {
      holdUntil: 'Sin divergencias activas. Mantener mientras el precio siga sobre la SMA50.',
      exitAt: levels.stopLoss,
      exitReason: `Si cae a ${p(levels.stopLoss)} → SELL.`,
    };
  }

  if (opp.action === 'WATCH') {
    if (bearishDivs.length > 0) {
      return {
        holdUntil: `Esperar a que las divergencias bajistas se resuelvan (~${estimatedDays ?? 3} dias) y el precio corrija.`,
        reEvaluateAt: nearestSupport ? nearestSupport.price : undefined,
        reEvaluateReason: nearestSupport
          ? `Si corrige a ${p(nearestSupport.price)}, evaluar entrada con mejor R/R.`
          : 'Esperar correccion de precio para mejor R/R.',
        exitAt: levels.stopLoss,
        exitReason: 'No entrar todavia.',
        estimatedDays: estimatedDays ?? 3,
      };
    }
    if (bullishDivs.length > 0) {
      return {
        holdUntil: `Divergencia alcista detectada. Confirmar con volumen y cierre sobre ${p(tech?.indicators.sma20 ?? price * 1.02)}.`,
        reEvaluateAt: levels.entryPrice,
        reEvaluateReason: `Entrada sugerida en ${p(levels.entryPrice)} si confirma.`,
        exitAt: levels.stopLoss,
        exitReason: `Stop en ${p(levels.stopLoss)} si entra.`,
        estimatedDays: estimatedDays ?? 3,
      };
    }

    // WATCH sin divergencias: dar condiciones concretas de upgrade
    if (opp.action === 'WATCH' && bullishDivs.length === 0 && bearishDivs.length === 0) {
      const rsi = tech?.indicators.rsi14;
      const upgradeConditions: string[] = [];
      if (rsi != null && rsi > 40) upgradeConditions.push(`RSI baje de 35 (ahora ${rsi.toFixed(0)})`);
      if (tech?.indicators.volumeRatio != null && tech.indicators.volumeRatio < 1.5)
        upgradeConditions.push(`Volumen suba a 1.5x promedio (ahora ${tech.indicators.volumeRatio.toFixed(1)}x)`);
      if (tech?.indicators.sma50 != null && (tech.indicators.currentPrice < tech.indicators.sma50))
        upgradeConditions.push(`Precio recupere SMA50 ($${tech.indicators.sma50.toFixed(2)})`);

      return {
        holdUntil: upgradeConditions.length > 0
          ? `Se convierte en BUY si: ${upgradeConditions.join(' + ')}.`
          : 'Sin condiciones claras de upgrade. Esperar nueva informacion.',
        exitAt: levels.stopLoss,
        exitReason: `No entrar a menos que se cumplan las condiciones.`,
      };
    }
  }

  if (opp.action === 'BUY') {
    return {
      holdUntil: `Comprar ahora. Target en ${p(levels.takeProfit)}, stop en ${p(levels.stopLoss)}.`,
      exitAt: levels.stopLoss,
      exitReason: `Si cae a ${p(levels.stopLoss)} despues de comprar → cortar perdida.`,
    };
  }

  if (opp.action === 'SELL') {
    return {
      holdUntil: 'Vender ahora o reducir posicion.',
      reEvaluateAt: nearestSupport ? nearestSupport.price : undefined,
      reEvaluateReason: nearestSupport
        ? `Si rebota en ${p(nearestSupport.price)} con divergencia alcista → re-evaluar compra.`
        : undefined,
      exitAt: price,
      exitReason: 'Salir al precio actual.',
    };
  }

  return undefined;
}

function scoreRsi(rsi: number | null | undefined, action: SignalAction = 'WATCH'): number {
  if (rsi == null) return 50;
  if (action === 'SELL') {
    if (rsi >= 70) return 100;
    if (rsi >= 55) return 70;
    if (rsi >= 45) return 30;
    return 0;
  }
  if (rsi <= 40) return 100;
  if (rsi <= 65) return 70;
  if (rsi <= 75) return 30;
  return 0;
}

function scoreRiskReward(rr: number | null | undefined): number {
  if (rr == null) return 40;
  if (rr >= 2.5) return 100;
  if (rr >= 1.5) return 60;
  return 0;
}

function scoreConflicts(count: number): number {
  if (count === 0) return 100;
  if (count === 1) return 60;
  if (count === 2) return 20;
  return 0;
}

function scoreSupportDistance(currentPrice: number, stopLoss: number | null | undefined): number {
  if (stopLoss == null || stopLoss >= currentPrice) return 50;
  const distPct = ((currentPrice - stopLoss) / currentPrice) * 100;
  if (distPct <= 2) return 100;
  if (distPct <= 5) return 70;
  if (distPct <= 10) return 40;
  return 10;
}

export function computeEntryScore(params: {
  rsi: number | null | undefined;
  riskReward: number | null | undefined;
  conflictCount: number;
  timingConfidence: number | null | undefined;
  currentPrice: number;
  stopLoss: number | null | undefined;
  action?: SignalAction;
}): number {
  const rsiScore = scoreRsi(params.rsi, params.action);
  const rrScore = scoreRiskReward(params.riskReward);
  const conflictScore = scoreConflicts(params.conflictCount);
  const timingScore = Math.min(100, Math.max(0, params.timingConfidence ?? 50));
  const supportScore = scoreSupportDistance(params.currentPrice, params.stopLoss);

  return Math.round(
    rsiScore * 0.25 +
    rrScore * 0.25 +
    conflictScore * 0.25 +
    timingScore * 0.15 +
    supportScore * 0.10,
  );
}

export function buildAlgorithmicOpportunity(
  symbol: string,
  tech: TechnicalSummary | undefined,
  fund: FundamentalSummary | undefined,
  sent: SentimentInput | undefined,
  inPortfolio: boolean,
  portfolioQuantity?: number,
  portfolioValue?: number,
  swingAlert?: { direction: 'BUY' | 'SELL'; winRate: number; avgReturn: number } | null,
  sectorSentiment?: number | null,
  evidenceResult?: { score: number; drivers: string[]; conviction: 'high' | 'medium' | 'low' | 'none'; activeSignals: number; hasData: boolean },
  causalChains?: Array<{ eventId: string; event?: string; ticker: string; category: string; direction: 'positive' | 'negative'; impact: 'direct' | 'indirect' }>,
  portfolioCtx?: PortfolioContext,
  candidateReturns?: number[],
): Opportunity | null {
  const techScore = tech?.score ?? 0;
  const fundScore = fund?.score ?? 0;
  const sentScore = sent?.score ?? 0;
  const evidenceScore = evidenceResult?.score ?? 0;

  const sector = getSectorForSymbolDynamic(symbol);
  if (!sector) return null;

  // Reject sub-penny / junk prices (illiquid, manipulable, unscoreable) unless already held.
  const MIN_PRICE = Number(process.env.MIN_PRICE_USD ?? '1');
  const priceForFloor = tech?.indicators.currentPrice ?? fund?.data.currentPrice ?? 0;
  if (!inPortfolio && (!Number.isFinite(priceForFloor) || priceForFloor < MIN_PRICE)) return null;

  const { shortTerm, mediumTerm, composite: compositeBase } = computeCompositeScore(techScore, fundScore, sentScore, undefined, evidenceScore);

  // === MACRO ADJUSTMENT: causalChains agregan/restan al composite ===
  const macroAdjustment = causalChains ? computeMacroAdjustment(symbol, causalChains) : undefined;
  let composite = compositeBase + (macroAdjustment?.delta ?? 0);

  // === PORTFOLIO ADJUSTMENT: correlación/concentración con la cartera (dial-gated) ===
  const portfolioIntensity = Number(process.env.PORTFOLIO_CORR_INTENSITY ?? '0');
  const portfolioAdjustment = portfolioCtx
    ? computePortfolioAdjustment(symbol, factorsForSymbol(symbol, sector), candidateReturns ?? [], portfolioCtx, portfolioIntensity)
    : undefined;
  composite += portfolioAdjustment?.delta ?? 0;

  if (composite < 0) composite = 0;
  if (composite > 100) composite = 100;
  const confluenceDetail = computeConfluenceDetail(tech, fund, sent);
  const confidence = confluenceDetail.confluencePercent;

  // Pre-calcular acción base sin conflictos para pasarla como contexto al detector
  const baseActionForConflicts = scoreToAction(composite, inPortfolio, confidence, false);

  const conflictOptions = {
    weeklyDivergences: tech?.weekly?.divergences,
    earningsInDays: fund?.data.nextEarningsDate
      ? Math.floor((new Date(fund.data.nextEarningsDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null,
    sectorSentiment: sectorSentiment ?? null,
    timingTriggers: tech?.timing?.triggers,           // FIX: detectar conflictos de timing
    baseAction: baseActionForConflicts as 'BUY' | 'SELL' | 'HOLD' | 'WATCH',
  };
  const hasConflicts = tech ? detectSignalConflicts(tech.indicators, sent ? { score: sent.score } : undefined, conflictOptions).length > 0 : false;
  let action = scoreToAction(composite, inPortfolio, confidence, hasConflicts);
  const algoActionPreVeto = action;

  // === AXIS VETO: si un eje individual está crítico, sobreescribe la acción ===
  const vetoResult = applyAxisVetos(action, techScore, fundScore, sentScore, evidenceScore, inPortfolio);
  const axisVeto = vetoResult.veto;
  action = vetoResult.action;

  // === CROSS-DIMENSION CONFLICTS: detectar disonancias entre los 4 ejes ===
  const crossConflicts = detectCrossConflicts(techScore, fundScore, sentScore, evidenceScore);

  const technicalAction = techScoreToAction(techScore, inPortfolio);
  const fundamentalAction = fundScoreToAction(fundScore, inPortfolio);
  const sentimentAction = sentScoreToAction(sentScore, inPortfolio);
  const currentPrice = tech?.indicators.currentPrice ?? fund?.data.currentPrice ?? 0;
  const rsi = tech?.indicators.rsi14;
  const pe = fund?.data.peRatio;
  const fpe = fund?.data.forwardPE;
  const sentScaled = Math.round(sentScore * 100);
  const distToSma50 = tech?.indicators.priceVsSma50 ?? 0;
  const distToSma200 = tech?.indicators.priceVsSma200 ?? 0;

  // Catalysts
  const catalysts: string[] = [];

  // Timing-based catalysts (highest priority — specific and actionable)
  const timing = tech?.timing;
  if (timing && timing.triggers.length > 0) {
    const topTriggers = timing.triggers
      .filter((t) => t.impact === 'high')
      .slice(0, 2);
    for (const trigger of topTriggers) {
      catalysts.push(trigger.description);
    }
  }

  if (rsi != null && rsi < 40 && catalysts.length < 3) catalysts.push(`RSI en ${rsi.toFixed(0)} — potencial rebote tecnico`);
  if (techScore > 0 && tech?.indicators.macd?.histogram && tech.indicators.macd.histogram > 0 && catalysts.length < 3)
    catalysts.push('MACD positivo confirma momentum');
  if (fundScore > 15 && catalysts.length < 3) catalysts.push('Valuacion por debajo de promedios historicos');
  if (fpe != null && pe != null && fpe < pe * 0.85 && catalysts.length < 3)
    catalysts.push(`Forward P/E (${fpe.toFixed(1)}) mejora vs actual (${pe.toFixed(1)})`);
  if (sentScaled > 20 && catalysts.length < 3) catalysts.push('Noticias recientes positivas');

  // Earnings date alert
  const earningsDate = fund?.data.nextEarningsDate;
  if (earningsDate) {
    const daysToEarnings = Math.floor((new Date(earningsDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysToEarnings >= 0 && daysToEarnings <= 14) {
      if (daysToEarnings <= 7) {
        catalysts.push(`Earnings en ${daysToEarnings} dias — alta volatilidad esperada`);
      } else {
        catalysts.push(`Earnings el ${earningsDate} (~${daysToEarnings}d)`);
      }
      if (fund.data.earningsSurprise != null && fund.data.earningsSurprise > 0) {
        catalysts.push(`Historial de superar expectativas (+${fund.data.earningsSurprise.toFixed(1)}%)`);
      }
    }
  }

  if (catalysts.length === 0) catalysts.push('Potencial de recuperacion tecnica');

  // Swing alert integration
  if (swingAlert && swingAlert.direction === 'BUY' && swingAlert.winRate > 60) {
    catalysts.push(`Swing alert activo: ${swingAlert.winRate.toFixed(0)}% win rate historico, retorno promedio ${swingAlert.avgReturn.toFixed(1)}%`);
  }

  // Risks
  const risks: string[] = [];
  if (rsi != null && rsi > 60) risks.push(`RSI en ${rsi.toFixed(0)} — posible sobrecompra`);
  if (fundScore < -10) risks.push('Valuacion elevada vs fundamentales');
  if (sentScaled < -10) risks.push('Sentimiento negativo en noticias');
  if (earningsDate) {
    const daysToEarnings = Math.floor((new Date(earningsDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysToEarnings >= 0 && daysToEarnings <= 7) {
      risks.push(`Earnings en ${daysToEarnings} dias — volatilidad alta, puede abrir con gap`);
    }
  }
  if (swingAlert && swingAlert.direction === 'SELL') {
    risks.push(`Swing alert bajista activo: patron historico sugiere caida`);
  }
  if (risks.length === 0) risks.push('Volatilidad general de mercado');

  // Reasoning (técnico — para el detalle expandible)
  const reasonParts: string[] = [];
  if (techScore > 0) reasonParts.push(`momentum tecnico positivo (score ${techScore})`);
  else if (techScore < 0) reasonParts.push(`debilidad tecnica (score ${techScore})`);
  if (fundScore > 15) reasonParts.push('valuacion atractiva');
  else if (fundScore < -15) reasonParts.push('valuacion elevada');
  if (rsi != null && rsi < 35) reasonParts.push(`RSI ${rsi.toFixed(0)} sugiere sobreventa`);
  if (sentScaled > 20) reasonParts.push('sentimiento positivo en noticias');

  if (timing && timing.action !== 'WAIT' && timing.estimatedDays != null) {
    const timingLabel = timing.timing === 'now' ? 'señal activa ahora'
      : timing.timing === 'soon' ? `señal esperada en ~${timing.estimatedDays} dias`
      : `señal acercandose (~${timing.estimatedDays} dias)`;
    reasonParts.push(`timing: ${timing.action} ${timingLabel}`);
  }

  const reasoning =
    reasonParts.length > 0
      ? `${symbol}: ${reasonParts.join(', ')}. Score ${composite}/100.`
      : `${symbol}: datos mixtos, requiere mas analisis. Score ${composite}/100.`;

  // Simple Reasoning (lenguaje humano, sin jerga)
  const simpleReasoning = buildSimpleReasoning(action, composite, confidence, confluenceDetail, techScore, fundScore, sentScaled, rsi, pe, distToSma50, inPortfolio);

  const result: Opportunity = {
    symbol,
    sector,
    sectorLabel: getSectorLabelDynamic(symbol, sector),
    currentPrice,
    opportunityScore: composite,
    action,
    technicalAction,
    fundamentalAction,
    sentimentAction,
    confidence,
    shortTerm: estimateShortTermReturn(tech, sent, fund, shortTerm, catalysts),
    mediumTerm: estimateMediumTermReturn(tech, fund, sent, mediumTerm),
    reasoning,
    simpleReasoning,
    catalysts: catalysts.slice(0, 3),
    risks: risks.slice(0, 2),
    breakdown: {
      technical: {
        signal: (tech?.signal ?? 'neutral') as TASignal,
        score: techScore,
        keyFactors: (() => {
          if (rsi == null) return ['Sin datos tecnicos'];
          const factors: string[] = [
            `RSI ${rsi.toFixed(0)} — ${rsi < 30 ? 'sobreventa' : rsi < 40 ? 'cerca de sobreventa' : rsi > 70 ? 'sobrecompra' : 'neutral'}`,
            `Precio ${distToSma50 > 0 ? '+' : ''}${distToSma50.toFixed(1)}% vs SMA50`,
          ];
          if (tech?.indicators.nearestSupport != null && tech.indicators.nearestSupport < 5) {
            factors.push(`Soporte a ${tech.indicators.nearestSupport.toFixed(1)}%`);
          }
          if (tech?.indicators.crossovers?.estimatedDaysToCross != null) {
            const dir = tech.indicators.crossovers.crossDirection === 'golden' ? 'Golden' : 'Death';
            factors.push(`${dir} Cross en ~${tech.indicators.crossovers.estimatedDaysToCross}d`);
          }
          return factors.slice(0, 3);
        })(),
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
    confluenceDetail,
    tradeLevels: computeTradeLevels(tech, action, portfolioValue, portfolioQuantity),
    trailingStop: tech?.trailingStop ?? null,
    avgDollarVolume: tech?.avgDollarVolume ?? null,
    timingView: buildTimingView(tech),
    classification: getClassificationForSymbol(symbol),
    divergences: tech?.divergences,
    weekly: tech?.weekly,
    signalConflicts: tech ? detectSignalConflicts(tech.indicators, sent ? { score: sent.score } : undefined, conflictOptions) : undefined,
    evidenceInfluence: evidenceResult ? {
      score: evidenceResult.score,
      drivers: evidenceResult.drivers,
      conviction: evidenceResult.conviction,
      activeSignals: evidenceResult.activeSignals,
      hasData: evidenceResult.hasData,
    } : undefined,
    axisVeto: axisVeto ?? undefined,
    crossConflicts: crossConflicts.length > 0 ? crossConflicts : undefined,
    macroAdjustment: macroAdjustment ?? undefined,
    portfolioAdjustment: portfolioAdjustment ?? undefined,
  };

  // === SMART ACTION: override based on divergences + trade levels ===
  const levels = result.tradeLevels;
  const smart = smartAction(result.action, composite, tech, fund, levels, inPortfolio, symbol);
  if (smart.action !== result.action) {
    result.action = smart.action;
    // Recalculate trade levels with new action
    result.tradeLevels = computeTradeLevels(tech, smart.action, portfolioValue, portfolioQuantity);
    // Replace reasoning with the coloquial smart reason
    if (smart.reason) {
      result.simpleReasoning = smart.reason;
      const shortReason = smart.reason.split('.')[0];
      result.catalysts = [shortReason, ...result.catalysts.filter(c => c !== shortReason)].slice(0, 3);
    }
  }

  // Post-smartAction safety: si smartAction subió a BUY, re-chequear conflictos con la acción final
  if (result.action === 'BUY' && tech) {
    const postConflicts = detectSignalConflicts(tech.indicators, sent ? { score: sent.score } : undefined, {
      ...conflictOptions,
      baseAction: 'BUY',
    });
    if (postConflicts.length > 0) {
      result.signalConflicts = postConflicts;
      result.action = 'WATCH';
      result.tradeLevels = computeTradeLevels(tech, 'WATCH', portfolioValue, portfolioQuantity);
    }
  }

  // === ANTICIPATORY UPGRADE: confluencia bullish (>=2 categorias) sube el veredicto ===
  // Contraparte alcista del override bajista. Misma fuente que las alertas anticipatorias
  // — el digest proyecta el action verbatim, asi que no puede haber doble discurso.
  // Gate: con signalConflicts activos NO se upgradea (mismo criterio que scoreToAction,
  // y evita revertir la demotion del safety block post-smartAction). El gate vive aca y
  // no en anticipatoryUpgrade porque AlertSource (deliberadamente minimo) no ve los
  // conflictos; queda sin unit test directo porque buildAlgorithmicOpportunity arrastra
  // la DB real (getActiveWeights/discovery-registry) y un fixture tecnico completo —
  // la regla pura equivalente (tape contradictorio = sin upgrade) esta cubierta en
  // anticipatory-alerts.test.ts ('conflicto bajista → nunca upgradea').
  if ((result.signalConflicts?.length ?? 0) === 0) {
    const upgraded = anticipatoryUpgrade(
      result.action,
      composite,
      result,
      result.tradeLevels?.riskRewardRatio,
      Boolean(axisVeto),
    );
    if (upgraded.action !== result.action) {
      result.action = upgraded.action;
      result.tradeLevels = computeTradeLevels(tech, upgraded.action, portfolioValue, portfolioQuantity);
      if (upgraded.reason) {
        result.simpleReasoning = upgraded.reason;
        // split('. ') y no split('.'): las descriptions traen decimales ("1.3/dia")
        result.catalysts = [upgraded.reason.split('. ')[0], ...result.catalysts].slice(0, 3);
      }
    }
  }

  // === SETUP INVÁLIDO: riesgo inaceptable (aún clampeado) degrada BUY a WATCH ===
  // Señal sin trade operable no es señal (caso SDOT: "soporte" a -90% del entry). Corre DESPUÉS
  // de todos los overrides bullish (smartAction, safety post-conflictos, anticipatoryUpgrade) —
  // ninguno puede pisarla — y ANTES de convictionTier/actionCondition/entryScore para que esos
  // campos reflejen la acción final en vez de quedar con framing de BUY mientras action ya es
  // WATCH (buildActionCondition tiene texto muy distinto por rama de acción).
  // No recalculamos tradeLevels: la rama BUY/WATCH de computeTradeLevels usa la misma fórmula
  // para ambas acciones, así que stopLoss/setupQuality ya son correctos.
  // SignalAction hoy no incluye STRONG_BUY (packages/shared/src/types/signal.ts) — si se agrega
  // en el futuro, sumar esa rama a la condición de abajo.
  const setupInvalidDegraded = result.tradeLevels?.setupQuality === 'invalid' && result.action === 'BUY';
  if (setupInvalidDegraded) {
    result.action = 'WATCH';
    // Reemplazar el reasoning: el texto de BUY ("buen momento para entrar") sería contradictorio
    // en una card WATCH + "no operar". Corre ANTES de resolveFinalVerdict, que lee
    // simpleReasoning para el smartReason del trace — así el trace también queda coherente.
    result.simpleReasoning = `Setup no operable: ${result.tradeLevels?.setupWarning ?? 'riesgo excede el máximo'}. Observar — no entrar hasta que el riesgo del setup se normalice.`;
    if (result.tradeLevels?.setupWarning) {
      result.risks = [result.tradeLevels.setupWarning, ...result.risks].slice(0, 3);
    }
  }

  // Compute conviction tier based on final state
  const hasBullishDivergence = tech?.divergences?.some(d => d.type === 'bullish') ?? false;
  const finalHasConflicts = (result.signalConflicts?.length ?? 0) > 0;
  result.convictionTier = getConvictionTier(
    result.opportunityScore,
    result.confidence,
    finalHasConflicts,
    hasBullishDivergence,
  );

  // === ACTION CONDITION: qué tiene que pasar para que cambie la acción ===
  result.actionCondition = buildActionCondition(result, tech);

  result.entryScore = computeEntryScore({
    rsi: tech?.indicators.rsi14,
    riskReward: result.tradeLevels?.riskRewardRatio,
    conflictCount: result.signalConflicts?.length ?? 0,
    timingConfidence: result.timingView?.confidence,
    currentPrice: result.currentPrice,
    stopLoss: result.tradeLevels?.stopLoss,
    action: result.action,
  });

  // === FINAL VERDICT CHAIN: trazabilidad algo → smart → (llm en otra fase) ===
  result.verdict = resolveFinalVerdict({
    algoAction: algoActionPreVeto,
    algoScore: composite,
    smartAction: result.action,
    // split('. ') y no split('.'): el reasoning de setup inválido trae decimales ("riesgo 24.4%")
    smartReason: result.simpleReasoning?.split('. ')[0],
    veto: axisVeto,
    portfolioAdjustment,
    // llmAction y llmReason se inyectan después en unified-analysis si aplica
  });

  // resolveFinalVerdict ya registra el cambio de acción como `smart:WATCH (...)` (smartAction
  // !== algoAction), pero esa es la etiqueta genérica de heurísticas de trade-levels/divergencias.
  // Un setup con riesgo inaceptable es una regla dura (misma categoría que applyAxisVetos), así
  // que anotamos el trace explícitamente en formato `veto:` para que quede distinguible en logs
  // y en el frontend — mismo mecanismo que usa la capa LLM en opportunities.service.ts (mutar
  // trace/finalAction directamente en vez de agregar un parámetro más a resolveFinalVerdict).
  if (setupInvalidDegraded) {
    result.verdict.trace.push(`veto:setup_invalido (${result.tradeLevels?.setupWarning})`);
  }

  return result;
}
