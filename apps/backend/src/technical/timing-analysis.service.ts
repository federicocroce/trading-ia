import type { OHLC, TechnicalIndicators, TimingSignal, TimingTrigger } from '@trading/shared';
import { calculateRSISeries, computeMACDSeries, calculateSMA, getCachedHistory } from './technical-analysis.service.js';

// =====================================================
// TIMING PREDICTION MODULE
//
// Analyzes indicator trends to estimate WHEN to buy/sell.
// Based on convergence rates, momentum trajectories, and
// proximity to key price levels.
// =====================================================

// --- SMA Crossover Timing ---

function estimateSMACrossoverDays(
  closes: number[],
  indicators: TechnicalIndicators,
): TimingTrigger | null {
  if (!indicators.crossovers) return null;

  // If a cross just happened, report it
  if (indicators.crossovers.goldenCross) {
    return {
      type: 'sma_cross',
      description: 'Golden Cross (SMA50 cruzó SMA200 hacia arriba) — señal alcista confirmada',
      estimatedDays: 0,
      impact: 'high',
    };
  }

  if (indicators.crossovers.deathCross) {
    return {
      type: 'sma_cross',
      description: 'Death Cross (SMA50 cruzó SMA200 hacia abajo) — señal bajista confirmada',
      estimatedDays: 0,
      impact: 'high',
    };
  }

  // Estimate upcoming cross
  const { estimatedDaysToCross, crossDirection } = indicators.crossovers;
  if (estimatedDaysToCross != null && estimatedDaysToCross > 0 && estimatedDaysToCross <= 15) {
    const dir = crossDirection === 'golden' ? 'alcista' : 'bajista';
    return {
      type: 'sma_cross',
      description: `${crossDirection === 'golden' ? 'Golden Cross' : 'Death Cross'} estimado en ~${estimatedDaysToCross} dias — señal ${dir} inminente`,
      estimatedDays: estimatedDaysToCross,
      impact: estimatedDaysToCross <= 5 ? 'high' : 'medium',
    };
  }

  return null;
}

// --- RSI Zone Entry Timing ---

function estimateRSIZoneEntry(
  closes: number[],
  currentRSI: number | null,
): TimingTrigger | null {
  if (currentRSI == null) return null;

  // Already in extreme zone
  if (currentRSI < 30) {
    return {
      type: 'rsi_zone',
      description: `RSI en ${currentRSI.toFixed(0)} — zona de sobreventa, rebote probable`,
      estimatedDays: 0,
      impact: 'high',
    };
  }
  if (currentRSI > 70) {
    return {
      type: 'rsi_zone',
      description: `RSI en ${currentRSI.toFixed(0)} — zona de sobrecompra, correccion probable`,
      estimatedDays: 0,
      impact: 'high',
    };
  }

  // Calculate RSI velocity (change per day over last 5 bars)
  const rsiSeries = calculateRSISeries(closes, 14, 5);
  if (rsiSeries.length < 3) return null;

  const rsiVelocity = (rsiSeries[rsiSeries.length - 1] - rsiSeries[0]) / (rsiSeries.length - 1);

  // Approaching oversold
  if (currentRSI < 40 && rsiVelocity < -1) {
    const daysToOversold = (30 - currentRSI) / Math.abs(rsiVelocity);
    if (daysToOversold > 0 && daysToOversold <= 10) {
      return {
        type: 'rsi_zone',
        description: `RSI ${currentRSI.toFixed(0)} cayendo ${Math.abs(rsiVelocity).toFixed(1)}/dia — sobreventa estimada en ~${Math.round(daysToOversold)} dias`,
        estimatedDays: Math.round(daysToOversold),
        impact: daysToOversold <= 3 ? 'high' : 'medium',
      };
    }
  }

  // Approaching overbought
  if (currentRSI > 60 && rsiVelocity > 1) {
    const daysToOverbought = (70 - currentRSI) / rsiVelocity;
    if (daysToOverbought > 0 && daysToOverbought <= 10) {
      return {
        type: 'rsi_zone',
        description: `RSI ${currentRSI.toFixed(0)} subiendo ${rsiVelocity.toFixed(1)}/dia — sobrecompra estimada en ~${Math.round(daysToOverbought)} dias`,
        estimatedDays: Math.round(daysToOverbought),
        impact: daysToOverbought <= 3 ? 'high' : 'medium',
      };
    }
  }

  return null;
}

// --- Support/Resistance Arrival Timing ---

function estimateSupportResistanceArrival(
  history: OHLC[],
  indicators: TechnicalIndicators,
): TimingTrigger | null {
  if (history.length < 10) return null;

  const currentPrice = indicators.currentPrice;

  // Calculate price velocity (linear regression slope over last 10 days)
  const recent = history.slice(-10);
  const pricesRecent = recent.map((h) => h.close);
  const n = pricesRecent.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += pricesRecent[i];
    sumXY += i * pricesRecent[i];
    sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const dailyChange = slope; // $ per day

  if (Math.abs(dailyChange) < 0.001) return null;

  // Check nearest support (price falling toward it)
  if (dailyChange < 0 && indicators.supports.length > 0) {
    const support = indicators.supports[0];
    const distance = currentPrice - support.price;
    if (distance > 0 && distance / currentPrice < 0.10) { // within 10%
      const daysToSupport = distance / Math.abs(dailyChange);
      if (daysToSupport > 0 && daysToSupport <= 15 && support.strength >= 1.5) {
        return {
          type: 'support_bounce',
          description: `Precio cayendo hacia soporte fuerte en $${support.price.toFixed(2)} (${support.touches} toques) — llegada estimada en ~${Math.round(daysToSupport)} dias`,
          estimatedDays: Math.round(daysToSupport),
          impact: support.strength >= 2.5 ? 'high' : 'medium',
        };
      }
    }
  }

  // Check nearest resistance (price rising toward it)
  if (dailyChange > 0 && indicators.resistances.length > 0) {
    const resistance = indicators.resistances[0];
    const distance = resistance.price - currentPrice;
    if (distance > 0 && distance / currentPrice < 0.10) {
      const daysToResistance = distance / dailyChange;
      if (daysToResistance > 0 && daysToResistance <= 15 && resistance.strength >= 1.5) {
        return {
          type: 'resistance_break',
          description: `Precio subiendo hacia resistencia en $${resistance.price.toFixed(2)} (${resistance.touches} toques) — llegada estimada en ~${Math.round(daysToResistance)} dias`,
          estimatedDays: Math.round(daysToResistance),
          impact: resistance.strength >= 2.5 ? 'high' : 'medium',
        };
      }
    }
  }

  return null;
}

// --- Bollinger Band Squeeze Timing ---

function estimateBBSqueezeTiming(indicators: TechnicalIndicators): TimingTrigger | null {
  if (!indicators.bbSqueeze || indicators.bbSqueezeIntensity == null) return null;

  if (indicators.bbSqueezeIntensity > 70) {
    // Determine likely breakout direction
    const direction = indicators.priceVsSma20 > 0 ? 'alcista' : 'bajista';
    return {
      type: 'bb_squeeze',
      description: `Bollinger Squeeze activo (intensidad ${indicators.bbSqueezeIntensity}%) — breakout ${direction} inminente`,
      estimatedDays: indicators.bbSqueezeIntensity > 85 ? 1 : 3,
      impact: indicators.bbSqueezeIntensity > 85 ? 'high' : 'medium',
    };
  }

  return null;
}

// --- MACD Cross Timing ---

function estimateMACDCross(
  closes: number[],
  indicators: TechnicalIndicators,
): TimingTrigger | null {
  if (!indicators.macd) return null;

  // Get MACD series for last 5 bars
  const ema12 = calculateEMALocal(closes, 12);
  const ema26 = calculateEMALocal(closes, 26);
  const series = computeMACDSeries(ema12, ema26, 5);

  if (series.length < 3) return null;

  // Check if MACD and signal are converging
  const gaps = series.map((s) => s.macdLine - s.signalLine);
  const currentGap = gaps[gaps.length - 1];
  const prevGap = gaps[0];
  const convergenceRate = (currentGap - prevGap) / (gaps.length - 1);

  if (Math.abs(convergenceRate) < 0.0001) return null;

  // Signs changing = cross imminent
  const crossingUp = currentGap < 0 && convergenceRate > 0;
  const crossingDown = currentGap > 0 && convergenceRate < 0;

  if (!crossingUp && !crossingDown) return null;

  const daysToTouch = Math.abs(currentGap / convergenceRate);
  if (daysToTouch > 10) return null;

  const direction = crossingUp ? 'alcista' : 'bajista';
  return {
    type: 'macd_cross',
    description: `MACD a punto de cruzar signal line (${direction}) en ~${Math.round(daysToTouch)} dias`,
    estimatedDays: Math.round(daysToTouch),
    impact: daysToTouch <= 3 ? 'high' : 'medium',
  };
}

// --- Stochastic Cross Timing ---

function estimateStochasticCross(indicators: TechnicalIndicators): TimingTrigger | null {
  if (!indicators.stochastic) return null;

  const { k, d } = indicators.stochastic;

  // Bullish: %K crosses above %D in oversold zone
  if (k < 25 && k > d) {
    return {
      type: 'stoch_cross',
      description: `Stochastic %K(${k.toFixed(0)}) cruzó %D(${d.toFixed(0)}) en zona de sobreventa — señal de compra`,
      estimatedDays: 0,
      impact: k < 15 ? 'high' : 'medium',
    };
  }

  // Bearish: %K crosses below %D in overbought zone
  if (k > 75 && k < d) {
    return {
      type: 'stoch_cross',
      description: `Stochastic %K(${k.toFixed(0)}) cruzó %D(${d.toFixed(0)}) en zona de sobrecompra — señal de venta`,
      estimatedDays: 0,
      impact: k > 85 ? 'high' : 'medium',
    };
  }

  return null;
}

// --- OBV Divergence Timing ---

function estimateOBVDivergence(indicators: TechnicalIndicators): TimingTrigger | null {
  if (!indicators.obvDivergence) return null;

  if (indicators.obvTrend === 'rising') {
    return {
      type: 'obv_divergence',
      description: 'Divergencia alcista OBV: precio baja pero volumen acumula — reversal probable',
      estimatedDays: 2,
      impact: 'high',
    };
  }

  if (indicators.obvTrend === 'falling') {
    return {
      type: 'obv_divergence',
      description: 'Divergencia bajista OBV: precio sube pero volumen distribuye — correccion probable',
      estimatedDays: 2,
      impact: 'high',
    };
  }

  return null;
}

// =====================================================
// MAIN: Combine all triggers into TimingSignal
// =====================================================

function isBuyTrigger(t: TimingTrigger): boolean {
  return (
    (t.type === 'sma_cross' && t.description.includes('alcista')) ||
    (t.type === 'rsi_zone' && t.description.includes('sobreventa')) ||
    t.type === 'support_bounce' ||
    (t.type === 'bb_squeeze' && t.description.includes('alcista')) ||
    (t.type === 'macd_cross' && t.description.includes('alcista')) ||
    (t.type === 'stoch_cross' && t.description.includes('compra')) ||
    (t.type === 'obv_divergence' && t.description.includes('alcista')) ||
    (t.type === 'rsi_divergence' && t.description.includes('alcista')) ||
    (t.type === 'macd_divergence' && t.description.includes('alcista'))
  );
}

function isSellTrigger(t: TimingTrigger): boolean {
  return (
    (t.type === 'sma_cross' && t.description.includes('bajista')) ||
    (t.type === 'rsi_zone' && t.description.includes('sobrecompra')) ||
    t.type === 'resistance_break' ||
    (t.type === 'bb_squeeze' && t.description.includes('bajista')) ||
    (t.type === 'macd_cross' && t.description.includes('bajista')) ||
    (t.type === 'stoch_cross' && t.description.includes('venta')) ||
    (t.type === 'obv_divergence' && t.description.includes('bajista')) ||
    (t.type === 'rsi_divergence' && t.description.includes('bajista')) ||
    (t.type === 'macd_divergence' && t.description.includes('bajista'))
  );
}

function computeTimingConfidence(triggers: TimingTrigger[]): number {
  if (triggers.length === 0) return 20;

  const highImpactCount = triggers.filter((t) => t.impact === 'high').length;
  const totalCount = triggers.length;

  // Base confidence from trigger count and impact
  let confidence = Math.min(90, 30 + totalCount * 12 + highImpactCount * 8);

  // Check consensus: do triggers agree on direction?
  const buyCount = triggers.filter(isBuyTrigger).length;
  const sellCount = triggers.filter(isSellTrigger).length;
  const consensus = Math.abs(buyCount - sellCount) / totalCount;

  // High consensus = higher confidence
  confidence = Math.round(confidence * (0.6 + consensus * 0.4));

  return Math.max(15, Math.min(90, confidence));
}

export function analyzeTimingSignals(
  history: OHLC[],
  indicators: TechnicalIndicators,
): TimingSignal {
  const closes = history.map((h) => h.close);
  const triggers: TimingTrigger[] = [];

  // Run all detectors
  const smaCross = estimateSMACrossoverDays(closes, indicators);
  const rsiZone = estimateRSIZoneEntry(closes, indicators.rsi14);
  const srArrival = estimateSupportResistanceArrival(history, indicators);
  const bbSqueeze = estimateBBSqueezeTiming(indicators);
  const macdCross = estimateMACDCross(closes, indicators);
  const stochCross = estimateStochasticCross(indicators);
  const obvDiv = estimateOBVDivergence(indicators);

  if (smaCross) triggers.push(smaCross);
  if (rsiZone) triggers.push(rsiZone);
  if (srArrival) triggers.push(srArrival);
  if (bbSqueeze) triggers.push(bbSqueeze);
  if (macdCross) triggers.push(macdCross);
  if (stochCross) triggers.push(stochCross);
  if (obvDiv) triggers.push(obvDiv);

  // Determine action based on trigger consensus
  const buyTriggers = triggers.filter(isBuyTrigger);
  const sellTriggers = triggers.filter(isSellTrigger);

  let action: 'BUY' | 'SELL' | 'WAIT';
  if (buyTriggers.length > sellTriggers.length && buyTriggers.length >= 2) {
    action = 'BUY';
  } else if (sellTriggers.length > buyTriggers.length && sellTriggers.length >= 2) {
    action = 'SELL';
  } else {
    action = 'WAIT';
  }

  // Determine timing — basado en los triggers que ALINEAN con la acción decidida.
  // No usar el trigger más cercano en días si ese trigger contradice la acción.
  // Ej: acción=BUY pero el trigger más cercano es un Death Cross (bajista) → no decir 'now'.
  const alignedTriggers = action === 'BUY' ? buyTriggers
    : action === 'SELL' ? sellTriggers
    : triggers; // WAIT: mostrar todos

  // Para BUY: ignorar triggers de alto impacto bajistas al calcular timing
  // Para SELL: ignorar triggers de alto impacto alcistas al calcular timing
  const highImpactOpposing = action === 'BUY'
    ? sellTriggers.filter(t => t.impact === 'high')
    : action === 'SELL'
    ? buyTriggers.filter(t => t.impact === 'high')
    : [];

  // Si hay triggers opuestos de alto impacto, el timing no puede ser 'now' — hay contradicción
  const hasHighImpactConflict = highImpactOpposing.length > 0;

  const alignedDays = alignedTriggers
    .map((t) => t.estimatedDays)
    .filter((d): d is number => d != null && d < 999);
  const minAlignedDays = alignedDays.length > 0 ? Math.min(...alignedDays) : null;

  // Fallback: si no hay días alineados, usar todos
  const allDays = triggers
    .map((t) => t.estimatedDays)
    .filter((d): d is number => d != null && d < 999);
  const minDays = minAlignedDays ?? (allDays.length > 0 ? Math.min(...allDays) : null);

  let timing: 'now' | 'soon' | 'approaching';
  if (hasHighImpactConflict) {
    // Con triggers contradictorios de alto impacto, degradar el timing al menos a 'soon'
    timing = minDays == null ? 'approaching'
      : minDays <= 3 ? 'soon'   // nunca 'now' si hay conflicto de alto impacto
      : 'approaching';
  } else {
    timing = minDays == null ? 'approaching'
      : minDays <= 1 ? 'now'
      : minDays <= 3 ? 'soon'
      : 'approaching';
  }

  return {
    action,
    timing,
    estimatedDays: minDays,
    confidence: computeTimingConfidence(triggers),
    triggers,
  };
}

// =====================================================
// Full timing-enriched summary
// =====================================================

export async function getTimingForSymbol(
  symbol: string,
  indicators: TechnicalIndicators,
): Promise<TimingSignal> {
  try {
    const history = await getCachedHistory(symbol);
    return analyzeTimingSignals(history, indicators);
  } catch {
    return {
      action: 'WAIT',
      timing: 'approaching',
      estimatedDays: null,
      confidence: 0,
      triggers: [],
    };
  }
}

// --- Local EMA helper (avoids circular imports for MACD cross) ---
function calculateEMALocal(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema.push(sum / period);
  for (let i = period; i < values.length; i++) {
    ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}
