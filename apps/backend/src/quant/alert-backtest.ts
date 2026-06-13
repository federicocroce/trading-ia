/**
 * Backtest de las REGLAS DE ALERTA ANTICIPATORIA del propio sistema.
 *
 * Idea honesta de "edge": ¿disparar la alerta (≥2 categorías bullish en confluencia)
 * predice mejor que entrar en una barra cualquiera, con el MISMO manejo de riesgo
 * (mismas bandas ATR, mismo horizonte)? Comparamos las barras-con-alerta contra el
 * base-rate de TODAS las barras. Si la confluencia no le gana al azar, no tiene edge.
 *
 * Este archivo es la parte PURA: agrega muestras ya evaluadas. La detección (replay de
 * los indicadores) y el forward (resolveAlertOutcome) viven en alert-backtest.service.ts.
 */

export type SampleOutcome = 'triggered' | 'missed' | 'expired';

export interface BarSample {
  fired: boolean;          // ¿la alerta disparó en esta barra?
  outcome: SampleOutcome;  // resultado del trade simulado a horizonte fijo
  returnPct: number;       // retorno al salir (target/stop/expiración)
}

export interface GroupStats {
  n: number;
  triggered: number;
  missed: number;
  expired: number;
  /** triggered / (triggered + missed), en %. Expira no cuenta como win ni loss. */
  winRate: number;
  /** retorno medio del grupo, en %. */
  avgReturn: number;
}

export interface AlertEdgeSummary {
  alerts: GroupStats;     // barras donde disparó la alerta
  baseline: GroupStats;   // TODAS las barras (base-rate incondicional)
  edgeWinRate: number;    // alerts.winRate - baseline.winRate
  edgeReturn: number;     // alerts.avgReturn - baseline.avgReturn
}

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function groupStats(samples: BarSample[]): GroupStats {
  const n = samples.length;
  const triggered = samples.filter((s) => s.outcome === 'triggered').length;
  const missed = samples.filter((s) => s.outcome === 'missed').length;
  const expired = samples.filter((s) => s.outcome === 'expired').length;
  const conclusive = triggered + missed;
  const avgReturn = n > 0 ? samples.reduce((a, s) => a + s.returnPct, 0) / n : 0;
  return {
    n,
    triggered,
    missed,
    expired,
    winRate: conclusive > 0 ? Math.round((triggered / conclusive) * 100) : 0,
    avgReturn: round(avgReturn),
  };
}

export function summarizeAlertEdge(samples: BarSample[]): AlertEdgeSummary {
  const alerts = groupStats(samples.filter((s) => s.fired));
  const baseline = groupStats(samples);
  return {
    alerts,
    baseline,
    edgeWinRate: alerts.winRate - baseline.winRate,
    edgeReturn: round(alerts.avgReturn - baseline.avgReturn),
  };
}
