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

  it('multi-sector: 3 Energía + 3 Tech concentrados a la vez → reporta AMBOS sectores, no solo uno', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'BUY'),
      mkRec('TSM', 'Tech', 'BUY'), mkRec('NVDA', 'Tech', 'BUY'), mkRec('AMD', 'Tech', 'BUY'),
    ]);
    expect(w).not.toBeNull();
    expect(w).toContain('Energía');
    expect(w).toContain('Tech');
    expect(w).toContain('6'); // totalBuys
  });

  it('multi-sector con conteos distintos: se listan ambos, ordenados por conteo descendente', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'BUY'), mkRec('CGC', 'Energía', 'BUY'),
      mkRec('TSM', 'Tech', 'BUY'), mkRec('NVDA', 'Tech', 'BUY'), mkRec('AMD', 'Tech', 'BUY'),
    ]);
    expect(w).not.toBeNull();
    // Energía (4) aparece antes que Tech (3) en el string.
    expect(w!.indexOf('Energía')).toBeLessThan(w!.indexOf('Tech'));
    expect(w).toContain('Energía (4)');
    expect(w).toContain('Tech (3)');
  });

  it('un solo sector concentrado entre varios sectores presentes: mantiene el string original de un-sector', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'BUY'),
      mkRec('TSM', 'Tech', 'BUY'), mkRec('MELI', 'Consumo', 'BUY'),
    ]);
    expect(w).toBe('⚠ Concentración: 3 de tus 5 recomendaciones BUY son el mismo trade (sector Energía) — diversificá o tomá una sola.');
  });
});
