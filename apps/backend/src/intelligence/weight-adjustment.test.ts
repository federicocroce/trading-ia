import { describe, it, expect } from 'vitest';
import { pearson, axisCorrelationsVsBenchmark, type AxisSample } from './weight-adjustment.service.js';

function s(tech: number, fund: number, sent: number, alpha: number | null): AxisSample {
  return { techScore: tech, fundScore: fund, sentScore: sent, alphaVsBenchmark: alpha };
}

describe('pearson', () => {
  it('correlación perfecta positiva = 1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });
  it('correlación perfecta negativa = -1', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it('muestra insuficiente o varianza cero devuelve 0 (no NaN)', () => {
    expect(pearson([1, 2], [1, 2])).toBe(0);          // n < 3
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0); // sin varianza en x
  });
});

describe('axisCorrelationsVsBenchmark', () => {
  // CAMBIO 2026-07-27: los pesos se calibran contra el ALPHA (exceso sobre el índice), no
  // contra win/loss. El outcome win/loss se define contra el propio stop/target, o sea
  // contra CERO: un eje que "acierta" señales con +0.5% en una ventana donde el índice hizo
  // +2% estaría siendo premiado por destruir valor.
  it('correlaciona cada eje contra el alpha, no contra un outcome binario', () => {
    // techScore sigue al alpha; fundScore va al revés; sentScore es constante (sin señal).
    const rows = [
      s(10, 90, 5, 1), s(20, 80, 5, 2), s(30, 70, 5, 3), s(40, 60, 5, 4), s(50, 50, 5, 5),
    ];
    const c = axisCorrelationsVsBenchmark(rows, 5);
    expect(c).not.toBeNull();
    expect(c!.technical).toBeCloseTo(1);
    expect(c!.fundamental).toBeCloseTo(-1);
    expect(c!.sentiment).toBe(0); // varianza cero ⇒ 0, jamás NaN
  });

  it('fail-closed: descarta filas sin alpha en vez de tratarlas como 0', () => {
    const rows = [
      s(10, 1, 1, 1), s(20, 2, 2, 2), s(30, 3, 3, 3),
      s(999, 999, 999, null), // sin cobertura de benchmark: NO puede contaminar
    ];
    const c = axisCorrelationsVsBenchmark(rows, 3);
    expect(c).not.toBeNull();
    expect(c!.technical).toBeCloseTo(1); // el outlier con alpha null quedó afuera
  });

  it('fail-closed: descarta filas con algún eje faltante', () => {
    const rows: AxisSample[] = [
      s(10, 1, 1, 1), s(20, 2, 2, 2), s(30, 3, 3, 3),
      { techScore: null, fundScore: 9, sentScore: 9, alphaVsBenchmark: 9 },
    ];
    expect(axisCorrelationsVsBenchmark(rows, 3)!.technical).toBeCloseTo(1);
  });

  it('devuelve null si no quedan suficientes filas medibles (nunca pesos con n ridículo)', () => {
    expect(axisCorrelationsVsBenchmark([s(1, 1, 1, 1), s(2, 2, 2, 2)], 20)).toBeNull();
    expect(axisCorrelationsVsBenchmark([], 20)).toBeNull();
  });

  it('respeta el mínimo configurable de filas', () => {
    const rows = [s(10, 1, 1, 1), s(20, 2, 2, 2), s(30, 3, 3, 3)];
    expect(axisCorrelationsVsBenchmark(rows, 3)).not.toBeNull();
    expect(axisCorrelationsVsBenchmark(rows, 4)).toBeNull();
  });
});
