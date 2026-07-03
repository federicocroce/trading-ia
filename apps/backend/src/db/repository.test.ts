import { describe, it, expect } from 'vitest';
import { segmentByStopRisk, computeExpectancy, type StopRiskRow } from './repository.js';

function row(entryPrice: number, stopLoss: number | null, rMultiple: number | null): StopRiskRow {
  return { entryPrice, stopLoss, rMultiple };
}

describe('segmentByStopRisk', () => {
  it('stop dentro del riesgo maximo (<=10%) va a clean', () => {
    const { clean, legacy } = segmentByStopRisk([row(100, 95, 1.5)], 10);
    expect(clean).toHaveLength(1);
    expect(legacy).toHaveLength(0);
  });

  it('stop que excede el riesgo maximo (>10%) va a legacy', () => {
    const { clean, legacy } = segmentByStopRisk([row(100, 80, -0.5)], 10);
    expect(clean).toHaveLength(0);
    expect(legacy).toHaveLength(1);
  });

  it('stop exactamente en el limite (10%) cuenta como clean (<=, no <)', () => {
    const { clean, legacy } = segmentByStopRisk([row(100, 90, 1)], 10);
    expect(clean).toHaveLength(1);
    expect(legacy).toHaveLength(0);
  });

  it('stop null va a legacy: sin nivel no hay evidencia de que el trade respetara el limite de riesgo', () => {
    const { clean, legacy } = segmentByStopRisk([row(100, null, null)], 10);
    expect(clean).toHaveLength(0);
    expect(legacy).toHaveLength(1);
  });

  it('mezcla clean/legacy se reparte correctamente', () => {
    const rows = [
      row(100, 95, 1.2),   // 5% -> clean
      row(100, 70, -0.8),  // 30% -> legacy
      row(50, 48, 0.5),    // 4% -> clean
      row(50, null, null), // sin stop -> legacy
    ];
    const { clean, legacy } = segmentByStopRisk(rows, 10);
    expect(clean).toHaveLength(2);
    expect(legacy).toHaveLength(2);
  });
});

describe('computeExpectancy', () => {
  it('promedia solo filas con rMultiple no-null', () => {
    const result = computeExpectancy([
      { rMultiple: 2 },
      { rMultiple: -1 },
      { rMultiple: null }, // no cuenta ni en el promedio ni en n
    ]);
    expect(result.n).toBe(2);
    expect(result.avg).toBe(0.5);
  });

  it('sin filas con rMultiple devuelve avg 0 y n 0', () => {
    const result = computeExpectancy([{ rMultiple: null }, { rMultiple: null }]);
    expect(result).toEqual({ avg: 0, n: 0 });
  });

  it('redondea a 2 decimales', () => {
    const result = computeExpectancy([{ rMultiple: 1 }, { rMultiple: 1 }, { rMultiple: 1.005 }]);
    expect(result.n).toBe(3);
    expect(result.avg).toBeCloseTo(1, 2);
  });
});
