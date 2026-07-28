import { describe, it, expect } from 'vitest';
import { selectDailySlice, dayIndexFor } from './daily-slice.js';

const U = Array.from({ length: 10 }, (_, i) => `S${i}`);

describe('selectDailySlice — rotación determinística sobre el universo', () => {
  // El screener no puede pagar un fetch técnico por cada uno de los ~3.000 símbolos todos
  // los días. La respuesta honesta NO es rankear (medido: el ranking no informa) sino mirar
  // una franja distinta cada día, sin sesgo, hasta cubrir todo.
  it('devuelve una franja del tamaño pedido', () => {
    expect(selectDailySlice(U, 3, 0)).toEqual(['S0', 'S1', 'S2']);
  });

  it('avanza la ventana con el día', () => {
    expect(selectDailySlice(U, 3, 1)).toEqual(['S3', 'S4', 'S5']);
    expect(selectDailySlice(U, 3, 2)).toEqual(['S6', 'S7', 'S8']);
  });

  it('da la vuelta al llegar al final: cobertura completa y cíclica', () => {
    expect(selectDailySlice(U, 3, 3)).toEqual(['S9', 'S0', 'S1']);
  });

  it('cubre TODO el universo en ceil(n/size) días, sin huecos', () => {
    const vistos = new Set<string>();
    for (let d = 0; d < Math.ceil(U.length / 3); d++) selectDailySlice(U, 3, d).forEach((s) => vistos.add(s));
    expect(vistos.size).toBe(U.length);
  });

  it('es determinística: el mismo día da la misma franja', () => {
    expect(selectDailySlice(U, 4, 7)).toEqual(selectDailySlice(U, 4, 7));
  });

  it('franja mayor o igual al universo devuelve todo, sin duplicar', () => {
    expect(selectDailySlice(U, 10, 5)).toHaveLength(10);
    expect(selectDailySlice(U, 99, 5)).toEqual(U);
  });

  it('casos borde: universo vacío o tamaño no positivo devuelven vacío', () => {
    expect(selectDailySlice([], 5, 0)).toEqual([]);
    expect(selectDailySlice(U, 0, 0)).toEqual([]);
    expect(selectDailySlice(U, -1, 0)).toEqual([]);
  });
});

describe('dayIndexFor', () => {
  it('avanza de a uno por día calendario', () => {
    const a = dayIndexFor(new Date('2026-07-28T10:00:00Z'));
    const b = dayIndexFor(new Date('2026-07-29T10:00:00Z'));
    expect(b - a).toBe(1);
  });

  it('la hora del día no cambia el índice (dos corridas el mismo día ven la misma franja)', () => {
    expect(dayIndexFor(new Date('2026-07-28T00:01:00Z'))).toBe(dayIndexFor(new Date('2026-07-28T23:59:00Z')));
  });
});
