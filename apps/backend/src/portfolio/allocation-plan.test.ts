import { describe, it, expect } from 'vitest';
import { layerForSymbol, buildAllocationPlan } from './allocation-plan.js';

const pos = (symbol: string, value: number) => ({ symbol, value, currentPrice: 100 });

describe('layerForSymbol', () => {
  it('ETFs índice → nucleo; oro/bonos → cobertura; acciones → riesgo', () => {
    expect(layerForSymbol('SPY')).toBe('nucleo');
    expect(layerForSymbol('gld')).toBe('cobertura');
    expect(layerForSymbol('GGAL')).toBe('riesgo');
  });
});

describe('buildAllocationPlan — fail-closed', () => {
  it('posición sin precio vivo: plan no generado, nombra al culpable', () => {
    const r = buildAllocationPlan({ positions: [{ symbol: 'GGAL', value: 100, currentPrice: 0 }], newCashUsd: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('GGAL');
  });

  it('cartera vacía sin aporte: no hay nada que planear', () => {
    expect(buildAllocationPlan({ positions: [], newCashUsd: 0 }).ok).toBe(false);
  });
});

describe('buildAllocationPlan — breakdown y violaciones', () => {
  it('cartera 100% riesgo: viola CARTERA_MAX_RIESGO y lo dice en español', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 76_000), pos('YPF', 24_000)], newCashUsd: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.violations.some((v) => v.includes('riesgo'))).toBe(true);
      expect(r.contributions).toEqual([]);
    }
  });

  it('posición individual sobre el cap del 20% aparece como violación con el símbolo', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 30_000), pos('SPY', 70_000)], newCashUsd: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.violations.some((v) => v.includes('GGAL'))).toBe(true);
  });
});

describe('buildAllocationPlan — aportes', () => {
  it('cartera toda en riesgo + aporte: todo el aporte va a nucleo y cobertura, nada a riesgo', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 100_000)], newCashUsd: 50_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const usd = Object.fromEntries(r.contributions.map((c) => [c.layer, c.usd]));
      expect((usd['nucleo'] ?? 0) + (usd['cobertura'] ?? 0)).toBe(50_000);
      expect(usd['riesgo'] ?? 0).toBe(0);
      // proporcional al déficit: nucleo (target 55) mucho más seco que cobertura (12)
      expect(usd['nucleo']).toBeGreaterThan(usd['cobertura']);
      expect(r.contributions.find((c) => c.layer === 'nucleo')!.instruments).toEqual(['SPY']);
      // sin excedente: el aporte entero (100k*55%+100k*12%=67k de déficit potencial... acá 50k < déficit total) entra en las capas
      expect(r.unallocatedUsd).toBe(0);
      // suma total exacta, sin fugas (regla de aritmética exacta)
      expect(r.contributions.reduce((s, c) => s + c.usd, 0) + r.unallocatedUsd).toBe(50_000);
    }
  });

  it('aporte excede el déficit total de las capas defensivas: cada capa capea en su déficit exacto y el resto queda sin asignar (unallocatedUsd)', () => {
    // SPY 55k, GLD 12k, GGAL 33k → total 100k; aporte 10k → totalPostAporte 110k
    // déficit nucleo = 55%*110k - 55k = 5.500; déficit cobertura = 12%*110k - 12k = 1.200; sumDeficits = 6.700 < 10.000
    const r = buildAllocationPlan({ positions: [pos('SPY', 55_000), pos('GLD', 12_000), pos('GGAL', 33_000)], newCashUsd: 10_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const usd = Object.fromEntries(r.contributions.map((c) => [c.layer, c.usd]));
      // (a) cada usd === déficit exacto de su capa; el resto (10.000 - 6.700 = 3.300) va a unallocatedUsd
      expect(usd['nucleo']).toBe(5_500);
      expect(usd['cobertura']).toBe(1_200);
      expect(r.unallocatedUsd).toBe(3_300);
      // (b) invariante por capa: ninguna contribución supera el déficit de su capa
      const deficitByLayer = { nucleo: 5_500, cobertura: 1_200 };
      for (const layer of ['nucleo', 'cobertura'] as const) {
        expect(usd[layer]!).toBeLessThanOrEqual(deficitByLayer[layer]);
      }
      // ninguna capa queda por encima de su target post-aporte
      const postNucleoPct = ((55_000 + usd['nucleo']!) / 110_000) * 100;
      const postCoberturaPct = ((12_000 + usd['cobertura']!) / 110_000) * 100;
      expect(postNucleoPct).toBeLessThanOrEqual(targetPctFrom(r, 'nucleo') + 1e-9);
      expect(postCoberturaPct).toBeLessThanOrEqual(targetPctFrom(r, 'cobertura') + 1e-9);
      // (c) suma total === newCashUsd incluyendo unallocatedUsd
      expect(r.contributions.reduce((s, c) => s + c.usd, 0) + r.unallocatedUsd).toBe(10_000);
    }
  });

  it('ninguna capa defensiva subponderada: todo el aporte queda sin asignar', () => {
    // nucleo y cobertura ya en (o por encima de) su target post-aporte → sumDeficits = 0
    const r = buildAllocationPlan({ positions: [pos('SPY', 60_000), pos('GLD', 15_000), pos('GGAL', 25_000)], newCashUsd: 1_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contributions.filter((c) => c.layer === 'nucleo' || c.layer === 'cobertura')).toEqual([]);
      expect(r.unallocatedUsd).toBe(1_000);
    }
  });

  it('los pct del breakdown se calculan sobre el total POST-aporte', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 50_000)], newCashUsd: 50_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const riesgo = r.layers.find((l) => l.layer === 'riesgo')!;
      expect(riesgo.pct).toBeCloseTo(50, 1); // 50k de 100k post-aporte
    }
  });
});

function targetPctFrom(r: Extract<ReturnType<typeof buildAllocationPlan>, { ok: true }>, layer: 'nucleo' | 'cobertura') {
  return r.layers.find((l) => l.layer === layer)!.targetPct;
}
