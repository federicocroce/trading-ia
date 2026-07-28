/**
 * I/O del diagnóstico de concentración: arma las series de retornos de la cartera real y
 * llama a la función pura. Ver `concentration.ts` para el porqué.
 */
import { getPortfolioPositions } from '../db/repository.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { getQuotes } from '../shared/yahoo.js';
import { analyzePortfolioConcentration, type HoldingSeries, type ConcentrationReport } from './concentration.js';

export interface ConcentrationView extends ConcentrationReport {
  /** Lectura en castellano para la UI: qué significa el número de apuestas efectivas. */
  veredicto: 'concentrada' | 'moderada' | 'diversificada';
  mensaje: string;
}

/** A partir de acá la cartera se comporta como una sola apuesta, sin importar cuántas filas tenga. */
const APUESTAS_CONCENTRADA = 2.5;
const APUESTAS_MODERADA = 4;

export async function getPortfolioConcentration(): Promise<ConcentrationView | null> {
  const positions = getPortfolioPositions().filter((p) => p.quantity > 0);
  if (positions.length === 0) return null;

  // Valor por posición con precio vivo. Fail-closed: sin precio, la posición no participa
  // (la función pura la descarta y lo reporta en `coverage`).
  const quotes = await getQuotes(positions.map((p) => p.symbol)).catch(() => []);
  const precio = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.current]));

  const valores = positions.map((p) => ({
    symbol: p.symbol,
    valor: (precio.get(p.symbol.toUpperCase()) ?? 0) * p.quantity,
  }));
  const total = valores.reduce((s, v) => s + v.valor, 0);
  if (total <= 0) return null;

  const holdings: HoldingSeries[] = [];
  for (const v of valores) {
    let returns: number[] = [];
    try {
      const c = await getHistoricalQuotes(v.symbol, '1y', '1d');
      for (let i = 1; i < c.length; i++) {
        if (c[i - 1].close > 0) returns.push((c[i].close - c[i - 1].close) / c[i - 1].close);
      }
    } catch { returns = []; }   // sin serie: la pura lo descarta, no se imputa nada
    holdings.push({ symbol: v.symbol, weight: v.valor / total, returns });
  }

  const r = analyzePortfolioConcentration(holdings);
  if (!r) return null;

  const veredicto = r.effectiveBets < APUESTAS_CONCENTRADA ? 'concentrada'
    : r.effectiveBets < APUESTAS_MODERADA ? 'moderada' : 'diversificada';

  const top = r.topHolding;
  const mensaje = veredicto === 'concentrada'
    ? `Tenés ${r.positions} posiciones pero se comportan como ${r.effectiveBets.toFixed(1)} apuestas independientes: ` +
      `están muy correlacionadas entre sí. Volatilidad anual ${(r.portfolioVol * 100).toFixed(0)}%` +
      `${top ? `, y ${top.symbol} sola es el ${(top.weight * 100).toFixed(0)}%` : ''}. ` +
      `Un stop protege de que UNA se dé vuelta; no protege de que se den vuelta todas juntas.`
    : veredicto === 'moderada'
    ? `${r.positions} posiciones ≈ ${r.effectiveBets.toFixed(1)} apuestas independientes. Volatilidad anual ${(r.portfolioVol * 100).toFixed(0)}%.`
    : `${r.positions} posiciones ≈ ${r.effectiveBets.toFixed(1)} apuestas independientes — bien repartida. Volatilidad anual ${(r.portfolioVol * 100).toFixed(0)}%.`;

  return { ...r, veredicto, mensaje };
}
