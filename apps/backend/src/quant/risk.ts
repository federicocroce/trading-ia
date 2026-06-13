/**
 * Columna de RIESGO — la parte robusta del sistema, independiente del edge de las señales.
 *
 * Dos piezas puras y testeables:
 *  - classifyRegime: filtro de régimen (índice sobre/bajo su media larga). El reductor de
 *    drawdown más confiable: en risk_off, cautela con entradas nuevas.
 *  - suggestPositionSize: sizing por riesgo — dimensiona para que tocar el stop pierda un %
 *    fijo del portfolio. Lo que evita que un solo trade te haga daño desproporcionado.
 *
 * El I/O (traer el precio del índice) vive en risk.service.ts.
 */

export type Regime = 'risk_on' | 'risk_off' | 'unknown';

export function classifyRegime(indexPrice: number | null, indexSma200: number | null): Regime {
  if (indexPrice == null || indexSma200 == null || indexSma200 <= 0) return 'unknown';
  return indexPrice > indexSma200 ? 'risk_on' : 'risk_off';
}

export interface PositionSizeInput {
  portfolioValue: number;
  entry: number;
  stop: number;
  /** Fracción del portfolio a arriesgar por trade (ej. 0.01 = 1%). */
  riskPct?: number;
  /** Cap de concentración: fracción máxima del portfolio en una posición. */
  maxPositionPct?: number;
}

export interface PositionSize {
  shares: number;
  dollars: number;
  /** Riesgo real en $ (acciones × distancia al stop). */
  riskAmount: number;
  /** Riesgo real como fracción del portfolio (≤ riskPct; menor si pegó el cap). */
  riskPct: number;
}

export function suggestPositionSize(input: PositionSizeInput): PositionSize | null {
  const { portfolioValue, entry, stop } = input;
  const riskPct = input.riskPct ?? 0.01;
  const maxPositionPct = input.maxPositionPct ?? 0.2;
  if (portfolioValue <= 0 || entry <= 0 || stop <= 0 || stop >= entry) return null;

  const perShareRisk = entry - stop;
  const riskBudget = portfolioValue * riskPct;
  let shares = Math.floor(riskBudget / perShareRisk);

  // Cap de concentración: nunca más de maxPositionPct del portfolio en una posición.
  const maxShares = Math.floor((portfolioValue * maxPositionPct) / entry);
  if (shares > maxShares) shares = maxShares;
  if (shares <= 0) return null;

  const dollars = Math.round(shares * entry * 100) / 100;
  const riskAmount = Math.round(shares * perShareRisk * 100) / 100;
  return { shares, dollars, riskAmount, riskPct: Math.round((riskAmount / portfolioValue) * 10000) / 10000 };
}
