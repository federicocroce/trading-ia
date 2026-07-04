import { describe, it, expect } from 'vitest';
import { segmentByStopRisk, computeExpectancy, type StopRiskRow, buildDiscoveredSymbolUpdate, type DiscoveredSymbolUpsertInput } from './repository.js';

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

function upsertInput(overrides: Partial<DiscoveredSymbolUpsertInput> = {}): DiscoveredSymbolUpsertInput {
  return {
    symbol: 'PFE',
    name: 'Pfizer Inc.',
    instrumentType: 'accion',
    sector: 'Salud',
    industry: 'Farmacéutica',
    market: 'us',
    exchange: 'NYSE',
    discoveredFrom: 'screener',
    expiresAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDiscoveredSymbolUpdate', () => {
  const NOW = '2026-07-04T12:00:00.000Z';

  it('refresca discoveredFrom y todo el contexto de clasificación con los datos entrantes', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 3, relevanceScore: 20 }, upsertInput(), NOW);
    expect(update.discoveredFrom).toBe('screener');
    expect(update.name).toBe('Pfizer Inc.');
    expect(update.sector).toBe('Salud');
    expect(update.industry).toBe('Farmacéutica');
    expect(update.instrumentType).toBe('accion');
    expect(update.market).toBe('us');
    expect(update.exchange).toBe('NYSE');
    expect(update.expiresAt).toBe('2026-07-18T00:00:00.000Z');
    expect(update.lastSeen).toBe(NOW);
    expect(update.active).toBe(true);
  });

  it('incrementa newsCount y relevanceScore (+10, cap 100) como antes', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 3, relevanceScore: 95 }, upsertInput(), NOW);
    expect(update.newsCount).toBe(4);
    expect(update.relevanceScore).toBe(100);
  });

  it('usa el relevanceScore entrante como piso: re-descubrimiento por screener levanta una fila de baja relevance', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput({ relevanceScore: 30 }), NOW);
    // max(10 + 10, 30) = 30 — sin piso quedaría en 20
    expect(update.relevanceScore).toBe(30);
  });

  it('sin relevanceScore entrante conserva el incremento simple', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput(), NOW);
    expect(update.relevanceScore).toBe(20);
  });

  it('tolera existing con nulls (filas viejas)', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: null, relevanceScore: null }, upsertInput(), NOW);
    expect(update.newsCount).toBe(1);
    expect(update.relevanceScore).toBe(10);
  });

  it('normaliza industry/exchange ausentes a null (no undefined)', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput({ industry: undefined, exchange: undefined }), NOW);
    expect(update.industry).toBeNull();
    expect(update.exchange).toBeNull();
  });
});
