/**
 * Centralized scoring weights — all magic numbers in one place.
 * These can be calibrated based on signal_tracking accuracy data.
 */

// --- Technical Scoring Weights (used in technical-analysis.service.ts scoreTechnical()) ---
export const TECHNICAL_WEIGHTS = {
  rsi: { base: 15, deltaMultiplier: 0.5 },
  macd: { max: 15 },
  sma200: { max: 15 },       // Changed from 12 → 15 (trend principal merece mas peso)
  sma50: { max: 12 },        // Changed from 15 → 12 (evitar redundancia con MACD)
  stochastic: { max: 10 },
  obv: { max: 18 },          // Changed from 12 → 18 (leading indicator, subestimado)
  supportResistance: { support: 8, resistance: -8 }, // Simetrizado (era +8/-5)
  // 8 → 4: el estudio de aislamiento de señales midió golden_cross como RUIDO
  // (z=0.04, edge inestable que cambia de signo entre períodos). Lagging + sin edge real.
  goldenDeathCross: { max: 4 },
  bbSqueeze: { bonus: 6 },     // Changed from 15% multiplicative → +6 additive
  volume: { maxAmplifier: 1.20 }, // Capped at 20% (was up to 30%)
} as const;

// --- Fundamental Scoring Weights (used in fundamental-analysis.service.ts scoreFundamental()) ---
export const FUNDAMENTAL_WEIGHTS = {
  peRatio: { cheap: 25, moderate: 10, expensive: -10, veryExpensive: -15, negative: -15 },
  forwardPE: { veryLow: 20, low: 10, moderate: 5, high: -10 },
  peImprovement: { massive: 15, good: 10 },
  maxPeContribution: 35,  // CAP total P/E related (was uncapped, could reach 60)
  fiftyTwoWeek: { nearLow: 15, nearishLow: 5, nearHigh: -10 },
  dividend: { high: 10, moderate: 5 },
  revenueGrowth: { veryHigh: 15, high: 10, moderate: 3, declining: -10 },
  debtToEquity: { low: 8, high: -5, veryHigh: -10 },
  freeCashFlow: { positive: 5, negative: -8 },
  roe: { veryHigh: 10, high: 8, negative: -5 },
  earningsSurprise: { good: 8, ok: 3, bad: -8 },
  operatingMargin: { excellent: 5, good: 3, negative: -5 },
} as const;

// --- Action Thresholds ---
export const ACTION_THRESHOLDS = {
  strongBuy: { minScore: 72, minConfidence: 70 },
  buy: { minScore: 58 },   // bajado de 62 → más señales en mercado volátil
  hold: { minScore: 52 },  // portfolio only
  holdWeak: { minScore: 42 }, // portfolio = HOLD, non-portfolio = WATCH
  sell: { below: 42 }, // portfolio only
} as const;

// --- Anti-Hype Filters ---
export const ANTI_HYPE = {
  rsiMax: 85,  // Only filter extreme overbought (changed from 30-75)
  maxFailures: 1, // pass with 2 of 3
} as const;

// --- SELL Thresholds ---
export const SELL_THRESHOLDS = {
  rsiDefault: 60,
  rsiHighBeta: 70, // For beta > 1.5
  betaThreshold: 1.5,
} as const;
