/**
 * Event-study: aprende EMPÍRICAMENTE qué le hace cada tipo de evento de mercado a cada sector.
 *
 * Honestidad de diseño: no tenemos 3 años de noticias guardadas, pero sí de PRECIOS. Así que
 * los eventos se definen por DATOS OBSERVABLES (petróleo, tasas, miedo, oro vía ETFs proxy),
 * no por el texto de una noticia. Eso es objetivo y re-computable. La noticia en vivo solo
 * sirve, después, para CLASIFICAR a qué tipo de evento se parece y buscar el playbook medido.
 *
 * Este archivo es la lógica PURA (detección + estadística). El I/O (precios, persistencia) en
 * event-study.service.ts.
 */

export interface Candle {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface EventDef {
  type: string;       // 'oil_shock_up'
  proxy: string;      // símbolo ETF cuya serie define el evento (ej. 'USO')
  window: number;     // días de la ventana de retorno
  direction: 'up' | 'down';
  thresholdPct: number; // umbral absoluto en % (ej. 8)
  label: string;      // descripción legible
}

/** Eventos de primera versión — definidos por proxies observables en Yahoo. */
export const EVENT_DEFS: EventDef[] = [
  { type: 'oil_shock_up', proxy: 'USO', window: 5, direction: 'up', thresholdPct: 8, label: 'Petróleo salta (+8% en 5d)' },
  { type: 'oil_shock_down', proxy: 'USO', window: 5, direction: 'down', thresholdPct: 8, label: 'Petróleo se desploma (−8% en 5d)' },
  { type: 'rate_spike', proxy: 'TLT', window: 5, direction: 'down', thresholdPct: 3, label: 'Tasas suben (TLT −3% en 5d)' },
  { type: 'risk_off', proxy: 'SPY', window: 5, direction: 'down', thresholdPct: 5, label: 'Risk-off (SPY −5% en 5d)' },
  { type: 'gold_surge', proxy: 'GLD', window: 5, direction: 'up', thresholdPct: 5, label: 'Oro salta (+5% en 5d)' },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Retorno % de los últimos `window` cierres terminando en i. null si no alcanza. */
export function windowReturnPct(closes: number[], i: number, window: number): number | null {
  if (i < window) return null;
  const past = closes[i - window];
  if (past === 0) return null;
  return ((closes[i] - past) / past) * 100;
}

/**
 * Fechas donde disparó el evento, con DEBOUNCE: una vez que dispara, espera `window` barras
 * antes de poder volver a disparar (un mismo shock no se cuenta varias veces).
 */
export function detectEventDates(candles: Candle[], def: EventDef): string[] {
  const closes = candles.map((c) => c.close);
  const out: string[] = [];
  let cooldown = 0;
  for (let i = def.window; i < candles.length; i++) {
    if (cooldown > 0) { cooldown--; continue; }
    const r = windowReturnPct(closes, i, def.window);
    if (r == null) continue;
    const fired = def.direction === 'up' ? r >= def.thresholdPct : r <= -def.thresholdPct;
    if (fired) { out.push(candles[i].date); cooldown = def.window; }
  }
  return out;
}

export interface MeanStats {
  mean: number;
  std: number;
  n: number;
  winRate: number; // % de valores > 0
}

export function meanStats(values: number[]): MeanStats {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, n: 0, winRate: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    mean: round2(mean),
    std: round2(Math.sqrt(variance)),
    n,
    winRate: Math.round((values.filter((v) => v > 0).length / n) * 100),
  };
}

/**
 * t de una muestra de (valores − baseline) contra 0: ¿la reacción tras el evento supera al
 * retorno "normal" del sector más allá del ruido? |t| ≥ ~2 ≈ significativo.
 */
export function edgeTStat(values: number[], baselineMean: number): number {
  const n = values.length;
  if (n < 2) return 0;
  const diffs = values.map((v) => v - baselineMean);
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  if (se === 0) return 0;
  return round2(mean / se);
}
