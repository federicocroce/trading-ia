import { describe, it, expect } from 'vitest';
import { analyzePortfolioConcentration, type HoldingSeries } from './concentration.js';

/** Serie sintética: `n` retornos que siguen un patrón dado (permite correlaciones exactas). */
function h(symbol: string, weight: number, rets: number[]): HoldingSeries {
  return { symbol, weight, returns: rets };
}

// Dos activos idénticos: correlación 1 → una sola apuesta por más que sean dos posiciones.
const A = [0.01, -0.02, 0.03, -0.01, 0.02, -0.03, 0.01, 0.02];
const B = [-0.01, 0.02, -0.03, 0.01, -0.02, 0.03, -0.01, -0.02]; // = -A (corr -1)

describe('analyzePortfolioConcentration', () => {
  it('dos posiciones idénticas cuentan como UNA apuesta efectiva', () => {
    const r = analyzePortfolioConcentration([h('X', 0.5, A), h('Y', 0.5, A)]);
    expect(r).not.toBeNull();
    expect(r!.effectiveBets).toBeCloseTo(1, 1);
    expect(r!.diversificationRatio).toBeCloseTo(1, 1);
  });

  it('dos posiciones perfectamente opuestas se cancelan: diversificación máxima', () => {
    const r = analyzePortfolioConcentration([h('X', 0.5, A), h('Y', 0.5, B)]);
    // La cartera es casi plana ⇒ ratio muy alto y apuestas efectivas >> 2.
    expect(r!.portfolioVol).toBeLessThan(0.001);
    expect(r!.effectiveBets).toBeGreaterThan(2);
  });

  it('una sola posición: exactamente 1 apuesta efectiva', () => {
    const r = analyzePortfolioConcentration([h('X', 1, A)]);
    expect(r!.effectiveBets).toBeCloseTo(1, 2);
  });

  it('reporta la posición más grande y su peso', () => {
    const r = analyzePortfolioConcentration([h('GRANDE', 0.7, A), h('chica', 0.3, B)]);
    expect(r!.topHolding).toEqual({ symbol: 'GRANDE', weight: 0.7 });
  });

  it('anualiza la volatilidad con 252 ruedas', () => {
    const r = analyzePortfolioConcentration([h('X', 1, A)]);
    // sd diaria de A × sqrt(252)
    const m = A.reduce((a, b) => a + b, 0) / A.length;
    const sd = Math.sqrt(A.reduce((s, x) => s + (x - m) ** 2, 0) / (A.length - 1));
    expect(r!.portfolioVol).toBeCloseTo(sd * Math.sqrt(252), 4);
  });

  it('fail-closed: sin posiciones, sin series, o series demasiado cortas devuelve null', () => {
    expect(analyzePortfolioConcentration([])).toBeNull();
    expect(analyzePortfolioConcentration([h('X', 1, [])])).toBeNull();
    expect(analyzePortfolioConcentration([h('X', 1, [0.01, 0.02])])).toBeNull(); // < MIN_OBS
  });

  it('fail-closed: descarta holdings sin serie utilizable en vez de imputar ceros', () => {
    // Imputar 0 a la que falta bajaría la volatilidad y INFLARÍA la diversificación —
    // justo el error que haría ver una cartera concentrada como si estuviera diversificada.
    const r = analyzePortfolioConcentration([h('X', 0.5, A), h('SIN_DATOS', 0.5, [])]);
    expect(r!.symbolsUsed).toEqual(['X']);
    expect(r!.coverage).toBeCloseTo(0.5, 2);
  });

  it('renormaliza los pesos de las posiciones que sí tienen serie', () => {
    const r = analyzePortfolioConcentration([h('X', 0.25, A), h('Y', 0.25, A), h('Z', 0.5, [])]);
    // X e Y quedan con 0.5 cada una: la cartera medible sigue sumando 1.
    expect(r!.effectiveBets).toBeCloseTo(1, 1);
    expect(r!.coverage).toBeCloseTo(0.5, 2);
  });

  it('usa solo las fechas comunes: series de largos distintos no rompen', () => {
    const r = analyzePortfolioConcentration([h('X', 0.5, A), h('Y', 0.5, A.slice(0, 5))]);
    expect(r).not.toBeNull();
    expect(r!.observations).toBe(5);
  });
});
