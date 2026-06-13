import { describe, it, expect } from 'vitest';
import { isExcludedInstrument, isLiquidEnough, isTradeable } from './tradeability.js';

describe('isExcludedInstrument (bonos / MLPs / preferidas / income — no son swing trades)', () => {
  it('excluye por tipo bono', () => {
    expect(isExcludedInstrument('Algo', 'bono')).toBe(true);
  });
  it('excluye ETFs de bonos / high yield por nombre', () => {
    expect(isExcludedInstrument('SPDR Bloomberg High Yield Bond ETF', 'etf')).toBe(true); // JNK
    expect(isExcludedInstrument('iShares 20+ Year Treasury Bond ETF', 'etf')).toBe(true);
  });
  it('excluye MLPs y preferidas por nombre', () => {
    expect(isExcludedInstrument('Global Partners LP', 'accion')).toBe(true); // GLP
    expect(isExcludedInstrument('Valley National Bancorp Preferred Series', 'accion')).toBe(true); // VLYPO-ish
  });
  it('NO excluye acciones/ETFs normales', () => {
    expect(isExcludedInstrument('Vista Energy', 'accion')).toBe(false);
    expect(isExcludedInstrument('Energy Select Sector SPDR Fund', 'etf')).toBe(false); // XLE
    expect(isExcludedInstrument('NVIDIA Corporation', 'accion')).toBe(false);
  });
});

describe('isLiquidEnough (volumen-dólar diario)', () => {
  it('pasa si el volumen-dólar supera el mínimo', () => {
    expect(isLiquidEnough(5_000_000)).toBe(true);
  });
  it('falla si es muy ilíquido (micro-cap)', () => {
    expect(isLiquidEnough(50_000)).toBe(false);
  });
  it('volumen desconocido (null) → no se puede afirmar liquidez → false', () => {
    expect(isLiquidEnough(null)).toBe(false);
  });
});

describe('isTradeable (combina tipo + liquidez)', () => {
  it('acción líquida normal → tradeable', () => {
    expect(isTradeable({ name: 'Vista Energy', instrumentType: 'accion', avgDollarVolume: 8_000_000 })).toBe(true);
  });
  it('bono líquido → NO tradeable (tipo manda)', () => {
    expect(isTradeable({ name: 'Junk Bond ETF', instrumentType: 'etf', avgDollarVolume: 50_000_000 })).toBe(false);
  });
  it('acción normal pero ilíquida → NO tradeable', () => {
    expect(isTradeable({ name: 'Tiny MicroCap Inc', instrumentType: 'accion', avgDollarVolume: 20_000 })).toBe(false);
  });
});
