import { describe, it, expect } from 'vitest';
import { scoreToAction } from './scoring.js';

// Caracterización del mapeo score → acción (núcleo del veredicto). Bloquea el comportamiento
// y verifica que sigue los ACTION_THRESHOLDS (config = fuente única).
describe('scoreToAction', () => {
  it('STRONG BUY: score≥72 + confidence≥70 + sin conflictos → BUY', () => {
    expect(scoreToAction(75, false, 70, false)).toBe('BUY');
  });

  it('score≥72 con conflictos → WATCH (no entra con tape contradictorio)', () => {
    expect(scoreToAction(75, false, 70, true)).toBe('WATCH');
  });

  it('score≥58 sin conflictos → BUY', () => {
    expect(scoreToAction(60, false, 0, false)).toBe('BUY');
  });

  it('score≥58 con conflictos → WATCH', () => {
    expect(scoreToAction(60, false, 0, true)).toBe('WATCH');
  });

  it('score 52-57 en portfolio → HOLD; fuera → WATCH', () => {
    expect(scoreToAction(55, true)).toBe('HOLD');
    expect(scoreToAction(55, false)).toBe('WATCH');
  });

  it('score 42-51 en portfolio → HOLD; fuera → WATCH', () => {
    expect(scoreToAction(45, true)).toBe('HOLD');
    expect(scoreToAction(45, false)).toBe('WATCH');
  });

  it('score <42 en portfolio → SELL; fuera → WATCH', () => {
    expect(scoreToAction(30, true)).toBe('SELL');
    expect(scoreToAction(30, false)).toBe('WATCH');
  });
});
