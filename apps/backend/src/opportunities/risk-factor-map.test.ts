import { describe, it, expect } from 'vitest';
import { factorsForSymbol } from './risk-factor-map.js';

describe('factorsForSymbol', () => {
  it('returns curated factors for known symbols', () => {
    expect(factorsForSymbol('YPF', undefined).sort()).toEqual(['argentina', 'emerging-markets', 'oil']);
    expect(factorsForSymbol('GLD', undefined).sort()).toEqual(['gold', 'safe-haven']);
    expect(factorsForSymbol('EOG', undefined).sort()).toEqual(['oil', 'us-equity']);
  });
  it('is case-insensitive', () => {
    expect(factorsForSymbol('ypf', undefined)).toContain('oil');
  });
  it('infers from sector when symbol is unknown', () => {
    expect(factorsForSymbol('UNKNOWN1', 'us-energy')).toContain('oil');
    expect(factorsForSymbol('UNKNOWN2', 'bonds')).toContain('rates');
  });
  it('returns [] for unknown symbol and unknown sector', () => {
    expect(factorsForSymbol('ZZZZ', 'made-up-sector')).toEqual([]);
  });
});

// Ampliación 2026-07-23: los 3 BUYs del día (VALE/BLK/GE) salían "sin clasificar" porque
// venían con sector 'etfs-sectors' (bolsa de gatos del discovery) y no estaban curados.
describe('factorsForSymbol — cobertura de candidatos frecuentes', () => {
  it('VALE es minera emergente: emerging-markets + risk-on', () => {
    expect(factorsForSymbol('VALE', 'etfs-sectors').sort()).toEqual(['emerging-markets', 'risk-on']);
  });
  it('financieras US (BLK y constituyentes del radar XLF): us-equity + risk-on', () => {
    for (const s of ['BLK', 'JPM', 'GS', 'TFC']) {
      expect(factorsForSymbol(s, undefined).sort()).toEqual(['risk-on', 'us-equity']);
    }
  });
  it('industriales US (GE): us-equity', () => {
    expect(factorsForSymbol('GE', 'etfs-sectors')).toEqual(['us-equity']);
  });
  it('semis del radar SMH: semis + us-equity', () => {
    for (const s of ['NVDA', 'AMD', 'TXN', 'SMH']) {
      expect(factorsForSymbol(s, undefined).sort()).toEqual(['semis', 'us-equity']);
    }
  });
  it("el sector 'etfs-sectors' NO clasifica solo (bolsa mixta): desconocido queda [] honesto", () => {
    expect(factorsForSymbol('DESCONOCIDA', 'etfs-sectors')).toEqual([]);
  });
});
