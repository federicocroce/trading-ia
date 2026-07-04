import { describe, it, expect } from 'vitest';
import { detectConcentrationWarning, type ConcentrationCandidate } from './correlation-warning.js';

// Helper local: arma un candidato mínimo (symbol, sector legible, action) sin depender
// del tipo completo de Opportunity/DigestRecommendation — la función pura solo necesita esto.
function mkRec(symbol: string, sector: string | undefined, action: ConcentrationCandidate['action']): ConcentrationCandidate {
  return { symbol, sector, action };
}

describe('detectConcentrationWarning', () => {
  it('avisa cuando 3+ recomendaciones BUY comparten sector', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'BUY'), mkRec('TSM', 'Tech', 'BUY'),
    ]);
    expect(w).toContain('Energía');
    expect(w).toContain('3');
  });

  it('null si no hay concentración', () => {
    expect(detectConcentrationWarning([mkRec('A', 'Tech', 'BUY'), mkRec('B', 'Salud', 'BUY')])).toBeNull();
  });

  it('null si el array está vacío', () => {
    expect(detectConcentrationWarning([])).toBeNull();
  });

  it('ignora SELL/HOLD/WATCH al agrupar — solo cuentan los BUY', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'SELL'), mkRec('CGC', 'Energía', 'HOLD'), mkRec('EDN', 'Energía', 'WATCH'),
    ]);
    expect(w).toBeNull();
  });

  it('fail-closed: sector undefined nunca cuenta para la concentración (no se agrupa como "undefined")', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', undefined, 'BUY'), mkRec('YPF', undefined, 'BUY'), mkRec('VIST', undefined, 'BUY'), mkRec('TSM', 'Tech', 'BUY'),
    ]);
    expect(w).toBeNull();
  });
});
