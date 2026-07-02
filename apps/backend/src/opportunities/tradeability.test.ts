import { describe, it, expect } from 'vitest';
import { isExcludedInstrument, isLiquidEnough, isTradeable, meetsQualityBar } from './tradeability.js';

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

describe('meetsQualityBar — barrera anti small-cap basura', () => {
  it('rechaza market cap < $500M (SDOT era ~$30M)', () => {
    expect(meetsQualityBar({ marketCap: 30_000_000, currentPrice: 24.58 })).toBe(false);
  });
  it('rechaza market cap desconocido (dato faltante = no pasa, no neutral)', () => {
    expect(meetsQualityBar({ marketCap: null, currentPrice: 50 })).toBe(false);
  });
  it('rechaza precio < $5 aunque el cap sea grande', () => {
    expect(meetsQualityBar({ marketCap: 2_000_000_000, currentPrice: 3.2 })).toBe(false);
  });
  it('acepta large-cap con precio normal', () => {
    expect(meetsQualityBar({ marketCap: 50_000_000_000, currentPrice: 180 })).toBe(true);
  });
  it('acepta justo en los umbrales', () => {
    expect(meetsQualityBar({ marketCap: 500_000_000, currentPrice: 5 })).toBe(true);
  });
});
