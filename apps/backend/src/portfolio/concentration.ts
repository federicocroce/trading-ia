/**
 * Diagnóstico de concentración de la cartera REAL.
 *
 * Por qué existe (2026-07-28, review adversarial): la app evaluaba si un CANDIDATO NUEVO
 * apilaba riesgo contra la cartera (`portfolio-risk.service.ts`), pero **nunca evaluaba la
 * cartera en sí**. Podía decir "esta compra apila Argentina" y jamás decir "tu cartera ES
 * Argentina".
 *
 * Medido sobre la cartera real del dueño: 8 posiciones que se comportan como **1.8 apuestas
 * independientes**, con **48% de volatilidad anualizada** (≈3× la del S&P). El clúster
 * argentino (GGAL/PAM/YPF/VIST = 76% del capital) correlaciona entre 0.51 y 0.86, y las dos
 * mineras de crypto entre sí 0.63. Contar posiciones no es contar apuestas.
 *
 * Eso es riesgo del objetivo #1 —proteger lo que ya tenés— y es más grande que cualquier
 * stop individual: un stop protege de que una posición se dé vuelta; nada protege de que
 * las ocho se den vuelta juntas.
 *
 * Puro: sin I/O. El fetch de series vive en concentration.service.ts.
 */

/** Mínimo de observaciones comunes para que la medición signifique algo. */
const MIN_OBS = 5;
const RUEDAS_POR_AÑO = 252;

export interface HoldingSeries {
  symbol: string;
  /** Peso en la cartera (0-1). Se renormaliza sobre las posiciones con serie utilizable. */
  weight: number;
  /** Retornos diarios, más antiguo primero. */
  returns: number[];
}

export interface ConcentrationReport {
  /** Volatilidad anualizada de la cartera tal como está compuesta. */
  portfolioVol: number;
  /** Suma ponderada de las volatilidades individuales (la cartera si nada correlacionara). */
  weightedVol: number;
  /** weightedVol / portfolioVol. 1.00 = cero diversificación. */
  diversificationRatio: number;
  /** Apuestas realmente independientes = ratio². Comparar contra el número de posiciones. */
  effectiveBets: number;
  positions: number;
  topHolding: { symbol: string; weight: number } | null;
  /** Fracción del capital que SÍ pudo medirse (las demás quedaron fuera, fail-closed). */
  coverage: number;
  symbolsUsed: string[];
  observations: number;
}

function desvio(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}

/**
 * Calcula cuántas apuestas independientes hay de verdad detrás de N posiciones.
 *
 * Fail-closed en dos puntos que importan:
 *  - Una posición sin serie utilizable se DESCARTA, jamás se imputa con ceros: imputar
 *    bajaría la volatilidad de la cartera e inflaría la diversificación, que es exactamente
 *    el error que haría ver una cartera concentrada como si estuviera repartida.
 *  - Los pesos se renormalizan sobre lo medible, y `coverage` reporta cuánto quedó afuera.
 */
export function analyzePortfolioConcentration(holdings: HoldingSeries[]): ConcentrationReport | null {
  const utiles = holdings.filter((h) => h.returns.length >= MIN_OBS && h.weight > 0);
  if (utiles.length === 0) return null;

  // Solo fechas comunes: comparar series de largos distintos mezclaría períodos.
  const largo = Math.min(...utiles.map((h) => h.returns.length));
  if (largo < MIN_OBS) return null;
  const series = utiles.map((h) => h.returns.slice(-largo));

  const pesoTotal = utiles.reduce((s, h) => s + h.weight, 0);
  const pesos = utiles.map((h) => h.weight / pesoTotal);

  const cartera: number[] = [];
  for (let i = 0; i < largo; i++) {
    cartera.push(series.reduce((s, serie, j) => s + pesos[j] * serie[i], 0));
  }

  const anual = (sd: number) => sd * Math.sqrt(RUEDAS_POR_AÑO);
  const portfolioVol = anual(desvio(cartera));
  const weightedVol = series.reduce((s, serie, j) => s + pesos[j] * anual(desvio(serie)), 0);

  // Cartera perfectamente cubierta (vol ≈ 0): el ratio tiende a infinito. Se acota para no
  // reportar un número sin sentido, y de todos modos ese caso no es "riesgoso".
  const diversificationRatio = portfolioVol > 1e-9
    ? Math.min(weightedVol / portfolioVol, 100)
    : 100;

  const mayor = utiles.reduce((a, b) => (b.weight > a.weight ? b : a));
  const capitalTotal = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    portfolioVol,
    weightedVol,
    diversificationRatio,
    effectiveBets: diversificationRatio ** 2,
    positions: utiles.length,
    topHolding: { symbol: mayor.symbol, weight: mayor.weight },
    coverage: capitalTotal > 0 ? pesoTotal / capitalTotal : 0,
    symbolsUsed: utiles.map((h) => h.symbol),
    observations: largo,
  };
}
