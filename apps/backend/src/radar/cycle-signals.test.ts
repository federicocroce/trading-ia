import { describe, it, expect } from 'vitest';
import {
  computeReturnPct, computeSma, computeSmaSide, computeFlowDeltaPct, classifyCycleState,
} from './cycle-signals.js';

// Serie sintética: n sesiones lineales de `desde` a `hasta`
const linear = (n: number, desde: number, hasta: number) =>
  Array.from({ length: n }, (_, i) => desde + ((hasta - desde) * i) / (n - 1));

describe('computeReturnPct', () => {
  it('retorno a N sesiones: (ultimo - close de hace N) / close de hace N', () => {
    const closes = [100, 110, 121];
    expect(computeReturnPct(closes, 2)).toBeCloseTo(21, 5);
  });

  it('historia insuficiente devuelve null (fail-closed)', () => {
    expect(computeReturnPct([100, 110], 2)).toBeNull();
    expect(computeReturnPct([], 63)).toBeNull();
  });

  it('close base <= 0 devuelve null', () => {
    expect(computeReturnPct([0, 50, 100], 2)).toBeNull();
  });
});

describe('computeSma', () => {
  it('promedio simple de las ultimas N sesiones', () => {
    expect(computeSma([1, 2, 3, 4], 2)).toBe(3.5);
  });

  it('historia insuficiente devuelve null', () => {
    expect(computeSma([1, 2], 3)).toBeNull();
  });
});

describe('computeSmaSide', () => {
  it('serie alcista sostenida: lado arriba, sesionesEnLado = ventana completa (cota inferior)', () => {
    const closes = linear(300, 100, 200); // siempre por encima de su SMA200
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('arriba');
    expect(r.sesionesEnLado).toBe(101); // 300 - 200 + 1 sesiones con SMA calculable
  });

  it('serie bajista sostenida: lado abajo', () => {
    const closes = linear(300, 200, 100);
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('abajo');
  });

  it('cruce reciente: cuenta sesiones desde el cruce, no la ventana', () => {
    // 280 sesiones cayendo fuerte + 20 sesiones de rebote violento sobre la SMA
    const closes = [...linear(280, 400, 100), ...linear(20, 300, 320)];
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('arriba');
    expect(r.sesionesEnLado).toBeGreaterThanOrEqual(1);
    expect(r.sesionesEnLado).toBeLessThanOrEqual(20);
  });

  it('historia insuficiente devuelve nulls', () => {
    expect(computeSmaSide(linear(150, 100, 110), 200)).toEqual({ lado: null, sesionesEnLado: null });
  });
});

describe('computeFlowDeltaPct', () => {
  it('delta % entre el ultimo y el de hace `lookback` snapshots', () => {
    const hist = [...Array(20).fill(1000), 1100]; // 21 valores
    expect(computeFlowDeltaPct(hist, 20)).toBeCloseTo(10, 5);
  });

  it('historia insuficiente devuelve null (acumulando)', () => {
    expect(computeFlowDeltaPct(Array(20).fill(1000), 20)).toBeNull();
  });

  it('null o <=0 en los extremos devuelve null (fail-closed)', () => {
    expect(computeFlowDeltaPct([null, ...Array(19).fill(1000), 1100], 20)).toBeNull();
    expect(computeFlowDeltaPct([...Array(20).fill(0), 1100], 20)).toBeNull();
  });
});

describe('classifyCycleState', () => {
  const base = { distSma200Pct: 5, rs3m: 1, rs6m: 1, lado: 'arriba' as const, sesionesEnLado: 100 };

  it('extendido: arriba de la SMA200 con distancia > 20%', () => {
    expect(classifyCycleState({ ...base, distSma200Pct: 25 }).state).toBe('extendido');
  });

  it('girando: cruce alcista hace <=60 sesiones con RS 3m positiva', () => {
    expect(classifyCycleState({ ...base, sesionesEnLado: 30, rs3m: 2 }).state).toBe('girando');
  });

  it('tendencia: arriba hace >60 sesiones con RS 3m >= 0', () => {
    expect(classifyCycleState({ ...base, sesionesEnLado: 100, rs3m: 0 }).state).toBe('tendencia');
  });

  it('odiado: abajo hace >=120 sesiones con RS 6m negativa', () => {
    expect(classifyCycleState({ ...base, lado: 'abajo', sesionesEnLado: 150, rs6m: -5 }).state).toBe('odiado');
  });

  it('neutro: lo que no matchea ninguna fase', () => {
    // abajo hace poco (ni odiado ni girando)
    expect(classifyCycleState({ ...base, lado: 'abajo', sesionesEnLado: 30, rs6m: -1 }).state).toBe('neutro');
    // arriba reciente pero RS 3m negativa (no girando)
    expect(classifyCycleState({ ...base, sesionesEnLado: 30, rs3m: -2 }).state).toBe('neutro');
  });

  it('extendido gana sobre girando (orden de precedencia del spec)', () => {
    const r = classifyCycleState({ ...base, distSma200Pct: 25, sesionesEnLado: 30, rs3m: 2 });
    expect(r.state).toBe('extendido');
  });

  it('cualquier input null => state null con reason (fail-closed)', () => {
    const r = classifyCycleState({ ...base, rs3m: null });
    expect(r.state).toBeNull();
    expect(r.reason).toContain('rs3m');
  });
});
