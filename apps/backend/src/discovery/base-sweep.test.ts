import { describe, it, expect, vi, beforeEach } from 'vitest';

// El universo real tiene ~500 símbolos S&P500 (sweep-universe.json). Lo reemplazamos por
// uno chico y controlado para que el test corra rápido y determinístico, sin red.
vi.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify(['ZZKNOWN', 'ZZOTHER']),
}));

const mockGetHistoricalQuotes = vi.fn();
vi.mock('../shared/yahoo.js', () => ({
  getHistoricalQuotes: (...args: unknown[]) => mockGetHistoricalQuotes(...args),
}));

const mockGetPortfolioPositions = vi.fn();
const mockGetLiveWatchlistItems = vi.fn();
const mockGetActiveSymbolList = vi.fn();
vi.mock('../db/repository.js', () => ({
  getPortfolioPositions: (...args: unknown[]) => mockGetPortfolioPositions(...args),
  getLiveWatchlistItems: (...args: unknown[]) => mockGetLiveWatchlistItems(...args),
  getActiveSymbolList: (...args: unknown[]) => mockGetActiveSymbolList(...args),
}));

const mockGetDiscoveredTickers = vi.fn();
const mockRegisterNovelTickers = vi.fn();
vi.mock('./discovery-registry.js', () => ({
  getDiscoveredTickers: (...args: unknown[]) => mockGetDiscoveredTickers(...args),
  registerNovelTickers: (...args: unknown[]) => mockRegisterNovelTickers(...args),
}));

import { runBaseSweep, selectSweepCandidates } from './base-sweep.service.js';

const det = (isBase: boolean, strength: number) => ({ isBase, strength, reasons: [] });

const barsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: `d${i}`, open: 1, high: 1, low: 1, close: 100 + i, volume: 1_000_000 }));

describe('selectSweepCandidates', () => {
  it('filtra no-bases, rankea por strength desc y corta en el cap', () => {
    const out = selectSweepCandidates([
      { symbol: 'A', detection: det(true, 1) },
      { symbol: 'B', detection: det(false, 0) },
      { symbol: 'C', detection: det(true, 2) },
      { symbol: 'D', detection: det(true, 2) },
    ], 2);
    expect(out).toEqual(['C', 'D']); // strength 2 primero; empate = orden de llegada
  });

  it('sin bases devuelve vacío', () => {
    expect(selectSweepCandidates([{ symbol: 'A', detection: det(false, 0) }], 10)).toEqual([]);
  });
});

describe('runBaseSweep — pre-filtro de conocidos', () => {
  beforeEach(() => {
    mockGetHistoricalQuotes.mockReset();
    mockGetPortfolioPositions.mockReset().mockReturnValue([]);
    mockGetLiveWatchlistItems.mockReset().mockReturnValue([]);
    mockGetActiveSymbolList.mockReset().mockReturnValue(['ZZKNOWN']);
    mockGetDiscoveredTickers.mockReset().mockReturnValue([]);
    mockRegisterNovelTickers.mockReset().mockResolvedValue(0);
  });

  it('excluye del barrido los símbolos que ya están en getActiveSymbolList (tabla symbols completa)', async () => {
    mockGetHistoricalQuotes.mockImplementation((symbol: string) => {
      if (symbol === 'SPY') return Promise.resolve(barsOf(250));
      return Promise.resolve(barsOf(10)); // historial insuficiente -> nunca isBase, no importa para este test
    });

    await runBaseSweep();

    const scanned = mockGetHistoricalQuotes.mock.calls.map((c) => c[0]).filter((s) => s !== 'SPY');
    expect(scanned).not.toContain('ZZKNOWN'); // ya conocido vía getActiveSymbolList: no debe consumir slot/fetch
    expect(scanned).toContain('ZZOTHER');
  });
});
