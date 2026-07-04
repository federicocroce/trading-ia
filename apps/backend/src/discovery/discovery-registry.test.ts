import { describe, it, expect } from 'vitest';
import { initialRelevanceForSource, selectEvictionCandidates } from './discovery-registry.js';

describe('initialRelevanceForSource', () => {
  it('screener entra con 30: ya pasó el embudo operable completo (quality bar, SMA200, setup+RR)', () => {
    expect(initialRelevanceForSource('screener')).toBe(30);
  });

  it('las fuentes de noticias/llm entran con el piso de 10 (una mención)', () => {
    expect(initialRelevanceForSource('finnhub')).toBe(10);
    expect(initialRelevanceForSource('yahoo')).toBe(10);
    expect(initialRelevanceForSource('llm')).toBe(10);
  });
});

describe('selectEvictionCandidates', () => {
  const row = (symbol: string, relevanceScore: number | null, lastSeen: string | null) =>
    ({ symbol, relevanceScore, lastSeen });

  it('ordena por relevance ascendente: los de menor relevance se evictan primero', () => {
    const rows = [
      row('ALTA', 50, '2026-07-01T00:00:00.000Z'),
      row('BAJA', 10, '2026-07-03T00:00:00.000Z'),
      row('MEDIA', 30, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol)).toEqual(['BAJA', 'MEDIA']);
  });

  it('a igual relevance desempata por lastSeen más viejo primero', () => {
    const rows = [
      row('RECIENTE', 10, '2026-07-03T00:00:00.000Z'),
      row('VIEJO', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('VIEJO');
  });

  it('un símbolo del screener (30) sobrevive frente a menciones sueltas de noticias (10)', () => {
    const rows = [
      row('NEWS1', 10, '2026-07-03T00:00:00.000Z'),
      row('SCREENER', 30, '2026-07-01T00:00:00.000Z'),
      row('NEWS2', 10, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol).sort()).toEqual(['NEWS1', 'NEWS2']);
  });

  it('relevance null cuenta como 0 (primero en evictarse)', () => {
    const rows = [
      row('SIN_SCORE', null, '2026-07-03T00:00:00.000Z'),
      row('CON_SCORE', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('SIN_SCORE');
  });

  it('no muta el array de entrada y respeta batchSize', () => {
    const rows = [row('A2', 20, null), row('B2', 10, null), row('C2', 30, null)];
    const copia = [...rows];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict).toHaveLength(2);
    expect(rows).toEqual(copia);
  });

  it('batchSize mayor que la cantidad de filas devuelve todas', () => {
    const rows = [row('UNO', 10, null), row('DOS', 20, null)];
    expect(selectEvictionCandidates(rows, 5)).toHaveLength(2);
  });
});
