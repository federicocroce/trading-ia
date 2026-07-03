import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS } from '../intelligence/weight-adjustment.service.js';
import { SHORT_TERM_WEIGHTS, MEDIUM_TERM_WEIGHTS } from './scoring.js';

// Invariantes de los pesos del score (Task 5 — desintoxicación del sentiment).
// Evidencia (relevamiento 2026-07-03, n=565): sentiment r=+0.03 (ruido), tech r=+0.24 (única señal),
// fund r=-0.07. Sentiment queda simbólico (0.05) hasta que weight proposals demuestren edge.
describe('pesos del score — invariantes', () => {
  const sum = (o: object) => Object.values(o).reduce((a: number, b) => a + Number(b), 0);

  it('DEFAULT_WEIGHTS (3 ejes) suman 1.0 en ambos horizontes', () => {
    expect(sum(DEFAULT_WEIGHTS.shortTerm)).toBeCloseTo(1.0, 3);
    expect(sum(DEFAULT_WEIGHTS.mediumTerm)).toBeCloseTo(1.0, 3);
  });

  it('pesos 4-ejes (fallback de scoring.ts) suman 1.0', () => {
    expect(sum(SHORT_TERM_WEIGHTS)).toBeCloseTo(1.0, 3);
    expect(sum(MEDIUM_TERM_WEIGHTS)).toBeCloseTo(1.0, 3);
  });

  it('sentiment ≤ 0.05 en todos los sets (r=0.03 medido: no paga más peso)', () => {
    expect(DEFAULT_WEIGHTS.shortTerm.sentiment).toBeLessThanOrEqual(0.05);
    expect(DEFAULT_WEIGHTS.mediumTerm.sentiment).toBeLessThanOrEqual(0.05);
    expect(SHORT_TERM_WEIGHTS.sentiment).toBeLessThanOrEqual(0.05);
    expect(MEDIUM_TERM_WEIGHTS.sentiment).toBeLessThanOrEqual(0.05);
  });
});
