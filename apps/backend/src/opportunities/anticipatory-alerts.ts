import type {
  AnticipatoryAlert,
  BullishSignal,
  BullishSignalCategory,
  DivergenceSignal,
  TimingView,
} from '@trading/shared';

/**
 * Subset estructural de Opportunity que necesita el detector. El scan completo
 * lo satisface (mismo patron que RecommendationSource en digest-recommendations).
 */
export interface AlertSource {
  symbol: string;
  currentPrice: number;
  opportunityScore: number;
  divergences?: DivergenceSignal[];
  timingView?: TimingView;
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
}

/** trigger.type → categoria. *_divergence colapsa en 'divergence' (dedup anti-confluencia-falsa). */
const TRIGGER_CATEGORY: Record<string, BullishSignalCategory> = {
  sma_cross: 'golden_cross',
  bb_squeeze: 'bb_squeeze',
  macd_cross: 'macd_cross',
  rsi_zone: 'oversold_bounce',
  rsi_divergence: 'divergence',
  macd_divergence: 'divergence',
  obv_divergence: 'divergence',
};

/**
 * Gate de anticipacion: estimatedDays === 0 significa "ya ocurrio" (confirmatorio).
 * Solo rsi_zone escapa al gate: la zona ES el setup, el rebote (lo anticipado) aun no paso.
 */
function passesAnticipationGate(type: string, estimatedDays: number | null): boolean {
  if (type === 'rsi_zone') return true;
  if (type.endsWith('_divergence')) return true; // divergencias anticipan reversal por naturaleza
  return estimatedDays != null && estimatedDays >= 1;
}

export function extractBullishSignals(opp: AlertSource): BullishSignal[] {
  const signals: BullishSignal[] = [];

  for (const d of opp.divergences ?? []) {
    if (d.type !== 'bullish') continue;
    signals.push({
      category: 'divergence',
      description: d.description,
      estimatedDays: null,
      timeframe: d.timeframe,
    });
  }

  for (const t of opp.timingView?.triggers ?? []) {
    if (t.direction !== 'bullish') continue;
    const category = TRIGGER_CATEGORY[t.type];
    if (!category) continue; // stoch_cross, support_bounce, resistance_break: fuera de taxonomia v1
    if (!passesAnticipationGate(t.type, t.estimatedDays)) continue;
    // dedup: si ya hay señal de divergencia (desde opp.divergences), no duplicar la categoria
    if (category === 'divergence' && signals.some(s => s.category === 'divergence')) continue;
    signals.push({ category, description: t.description, estimatedDays: t.estimatedDays });
  }

  return signals;
}

/** Regla de conflicto: tape contradictorio = sin alerta. Un override bajista siempre gana. */
export function hasBearishConflict(opp: AlertSource): boolean {
  if ((opp.divergences ?? []).some(d => d.type === 'bearish')) return true;
  if (opp.timingView?.action === 'SELL') return true;
  return false;
}

export function buildAlertsFromScan(opps: AlertSource[], scanDate: string): AnticipatoryAlert[] {
  const alerts: AnticipatoryAlert[] = [];

  for (const opp of opps) {
    if (hasBearishConflict(opp)) continue;
    const signals = extractBullishSignals(opp);
    const categories = [...new Set(signals.map(s => s.category))].sort();
    if (categories.length < 2) continue;

    alerts.push({
      id: `${opp.symbol}:${categories.join('+')}`,
      kind: 'anticipatory',
      symbol: opp.symbol,
      signals,
      currentPrice: opp.currentPrice,
      entryPrice: opp.tradeLevels?.entryPrice ?? opp.currentPrice,
      stopLoss: opp.tradeLevels?.stopLoss,
      takeProfit: opp.tradeLevels?.takeProfit,
      score: opp.opportunityScore,
      status: 'active',
      firstSeenDate: scanDate,
      lastSeenDate: scanDate,
      seen: false,
    });
  }

  return alerts;
}
