import { describe, it, expect } from 'vitest';
import { evaluateThesis, type ThesisState } from './thesis-evaluator.js';

function mkState(overrides: Partial<ThesisState> = {}): ThesisState {
  return {
    status: 'activa',
    direction: 'alcista',
    entryTriggerPrice: 100,
    entryComparator: 'above',
    invalidationPrice: 80,
    horizonDays: 30,
    createdDate: '2026-01-01',
    triggeredAt: null,
    ...overrides,
  };
}

describe('evaluateThesis — fail-closed sin precio', () => {
  it('price null, NaN o Infinity → sin transición', () => {
    const t = mkState({ status: 'activa' });
    for (const price of [null, NaN, Infinity, -Infinity]) {
      const result = evaluateThesis(t, price, '2026-01-15');
      expect(result.newStatus).toBeNull();
    }
  });
});

describe('evaluateThesis — estados terminales nunca transicionan', () => {
  it('cumplida/invalidada/expirada permanecen sin transición sin importar precio ni fecha', () => {
    for (const status of ['cumplida', 'invalidada', 'expirada']) {
      const t = mkState({ status, entryTriggerPrice: 100, invalidationPrice: 80, horizonDays: 5 });
      // precio que tocaría invalidación Y fecha muy posterior al horizonte
      const result = evaluateThesis(t, 50, '2027-01-01');
      expect(result.newStatus, `status terminal ${status} no debería transicionar`).toBeNull();
    }
  });
});

describe('evaluateThesis — activa: invalidación tocada → invalidada', () => {
  it('alcista: price <= invalidationPrice; bajista: price >= invalidationPrice', () => {
    const alcista = mkState({ status: 'activa', direction: 'alcista', invalidationPrice: 80, entryTriggerPrice: 130 });
    expect(evaluateThesis(alcista, 80, '2026-01-05').newStatus).toBe('invalidada');
    expect(evaluateThesis(alcista, 75, '2026-01-05').newStatus).toBe('invalidada');

    const bajista = mkState({ status: 'activa', direction: 'bajista', entryComparator: 'below', invalidationPrice: 120, entryTriggerPrice: 70 });
    expect(evaluateThesis(bajista, 120, '2026-01-05').newStatus).toBe('invalidada');
    expect(evaluateThesis(bajista, 125, '2026-01-05').newStatus).toBe('invalidada');
  });
});

describe('evaluateThesis — activa: entry tocada → gatillada', () => {
  it('above: price >= trigger; below: price <= trigger (sin tocar invalidación)', () => {
    const alcista = mkState({ status: 'activa', direction: 'alcista', entryComparator: 'above', entryTriggerPrice: 100, invalidationPrice: 80 });
    expect(evaluateThesis(alcista, 100, '2026-01-05').newStatus).toBe('gatillada');
    expect(evaluateThesis(alcista, 105, '2026-01-05').newStatus).toBe('gatillada');

    const bajista = mkState({ status: 'activa', direction: 'bajista', entryComparator: 'below', entryTriggerPrice: 100, invalidationPrice: 130 });
    expect(evaluateThesis(bajista, 100, '2026-01-05').newStatus).toBe('gatillada');
    expect(evaluateThesis(bajista, 95, '2026-01-05').newStatus).toBe('gatillada');
  });
});

describe('evaluateThesis — invalidación gana si entry e invalidación se tocan a la vez', () => {
  it('fail-closed: en la duda, la tesis muere (invalidada, no gatillada)', () => {
    // alcista "buy the dip": comparator below, invalidationPrice < entryTriggerPrice.
    // Si el precio cae debajo de ambos, toca las dos condiciones a la vez.
    const dipBuy = mkState({
      status: 'activa', direction: 'alcista', entryComparator: 'below',
      entryTriggerPrice: 95, invalidationPrice: 90,
    });
    expect(evaluateThesis(dipBuy, 85, '2026-01-05').newStatus).toBe('invalidada');

    // bajista "short the bounce": comparator above, invalidationPrice > entryTriggerPrice.
    // Si el precio sube sobre ambos, toca las dos condiciones a la vez.
    const bounceShort = mkState({
      status: 'activa', direction: 'bajista', entryComparator: 'above',
      entryTriggerPrice: 105, invalidationPrice: 110,
    });
    expect(evaluateThesis(bounceShort, 115, '2026-01-05').newStatus).toBe('invalidada');
  });
});

describe('evaluateThesis — activa: horizonte vencido sin gatillo → expirada', () => {
  it('today > createdDate + horizonDays y niveles no tocados', () => {
    const t = mkState({
      status: 'activa', direction: 'alcista', entryTriggerPrice: 100, invalidationPrice: 80,
      createdDate: '2026-01-01', horizonDays: 10,
    });
    // precio intermedio: no toca invalidación (80) ni trigger (100)
    const result = evaluateThesis(t, 90, '2026-01-12');
    expect(result.newStatus).toBe('expirada');
  });
});

describe('evaluateThesis — activa: horizonte no vencido y niveles no tocados → sin transición', () => {
  it('today dentro del horizonte (incluyendo el límite exacto) no expira', () => {
    const t = mkState({
      status: 'activa', direction: 'alcista', entryTriggerPrice: 100, invalidationPrice: 80,
      createdDate: '2026-01-01', horizonDays: 10,
    });
    expect(evaluateThesis(t, 90, '2026-01-08').newStatus).toBeNull();
    // límite exacto (createdDate + horizonDays) todavía no es "vencido" (regla es today > límite)
    expect(evaluateThesis(t, 90, '2026-01-11').newStatus).toBeNull();
  });
});

describe('evaluateThesis — gatillada: invalidación tocada → invalidada', () => {
  it('alcista y bajista, ya gatillada', () => {
    const alcista = mkState({
      status: 'gatillada', direction: 'alcista', invalidationPrice: 80, entryTriggerPrice: 100,
      triggeredAt: '2026-01-05',
    });
    expect(evaluateThesis(alcista, 78, '2026-01-10').newStatus).toBe('invalidada');

    const bajista = mkState({
      status: 'gatillada', direction: 'bajista', entryComparator: 'below', invalidationPrice: 120, entryTriggerPrice: 100,
      triggeredAt: '2026-01-05',
    });
    expect(evaluateThesis(bajista, 122, '2026-01-10').newStatus).toBe('invalidada');
  });
});

describe('evaluateThesis — gatillada: horizonte vencido sin invalidarse → cumplida', () => {
  it('sobrevivió el horizonte (desde createdDate); dentro del horizonte, sin transición', () => {
    const t = mkState({
      status: 'gatillada', direction: 'alcista', invalidationPrice: 80, entryTriggerPrice: 100,
      createdDate: '2026-01-01', horizonDays: 10, triggeredAt: '2026-01-03',
    });
    // precio sano, no toca invalidación
    expect(evaluateThesis(t, 95, '2026-01-08').newStatus).toBeNull();
    expect(evaluateThesis(t, 95, '2026-01-12').newStatus).toBe('cumplida');
  });
});
