import { describe, it, expect } from 'vitest';
import { selectSweepCandidates } from './base-sweep.service.js';

const det = (isBase: boolean, strength: number) => ({ isBase, strength, reasons: [] });

describe('selectSweepCandidates', () => {
  it('filtra no-bases, rankea por strength desc y corta en el cap', () => {
    const out = selectSweepCandidates([
      { symbol: 'A', detection: det(true, 1) },
      { symbol: 'B', detection: det(false, 0) },
      { symbol: 'C', detection: det(true, 2) },
      { symbol: 'D', detection: det(true, 2) },
    ], 2);
    expect(out).toEqual(['C', 'D']); // strength 2 primero; empate = orden de llegada
  });

  it('sin bases devuelve vacío', () => {
    expect(selectSweepCandidates([{ symbol: 'A', detection: det(false, 0) }], 10)).toEqual([]);
  });
});
