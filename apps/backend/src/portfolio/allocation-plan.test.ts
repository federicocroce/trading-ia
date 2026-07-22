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
    }
  });

  it('capa ya en target no recibe aporte', () => {
    // nucleo 55% exacto post-aporte de 0: SPY 55k de 100k total
    const r = buildAllocationPlan({ positions: [pos('SPY', 55_000), pos('GLD', 12_000), pos('GGAL', 33_000)], newCashUsd: 10_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // post-aporte el total es 110k: nucleo 50% (<55) y cobertura 10.9% (<12) → ambos reciben; suma = 10k
      expect(r.contributions.reduce((s, c) => s + c.usd, 0)).toBe(10_000);
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
