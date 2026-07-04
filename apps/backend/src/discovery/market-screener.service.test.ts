import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMarketScreener } from './market-screener.service.js';

// Mocks en la frontera de I/O (Yahoo, técnicos, registro en discovered_symbols) — igual
// patrón que unified-analysis-card.test.ts: solo se controla lo que cruza el borde.
const mockFetchScreenerQuotes = vi.fn();
const mockFilterScreenerCandidates = vi.fn();
const mockGetTechnicalSummary = vi.fn();
const mockComputeTradeLevels = vi.fn();
const mockRegisterNovelTickers = vi.fn();

vi.mock('../shared/yahoo-screener.js', () => ({
  fetchScreenerQuotes: (...args: unknown[]) => mockFetchScreenerQuotes(...args),
}));
vi.mock('./market-screener.js', () => ({
  filterScreenerCandidates: (...args: unknown[]) => mockFilterScreenerCandidates(...args),
}));
vi.mock('../technical/technical-analysis.service.js', () => ({
  getTechnicalSummary: (...args: unknown[]) => mockGetTechnicalSummary(...args),
}));
vi.mock('../opportunities/scoring.js', () => ({
  computeTradeLevels: (...args: unknown[]) => mockComputeTradeLevels(...args),
}));
vi.mock('./discovery-registry.js', () => ({
  registerNovelTickers: (...args: unknown[]) => mockRegisterNovelTickers(...args),
}));

function tech(symbol: string, over: { sma200?: number | null; currentPrice?: number } = {}) {
  return {
    symbol,
    indicators: {
      sma200: over.sma200 ?? 100,
      currentPrice: over.currentPrice ?? 120,
    },
  };
}

describe('runMarketScreener — embudo alineado con anti-hype (precio > SMA200, scoring.ts:696)', () => {
  beforeEach(() => {
    mockFetchScreenerQuotes.mockReset();
    mockFilterScreenerCandidates.mockReset();
    mockGetTechnicalSummary.mockReset();
    mockComputeTradeLevels.mockReset();
    mockRegisterNovelTickers.mockReset();
    mockFetchScreenerQuotes.mockResolvedValue([]);
    mockRegisterNovelTickers.mockResolvedValue(0);
  });

  it('descarta un candidato con precio <= SMA200 aunque el setup técnico sea valid (caso real: scan #159 rechazó CMCSA/QXO por esto mismo, después de que el screener ya los había registrado)', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'CMCSA' }]);
    mockGetTechnicalSummary.mockResolvedValue(tech('CMCSA', { sma200: 100, currentPrice: 90 }));
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'valid', riskRewardRatio: 3 });

    const result = await runMarketScreener();

    expect(result.operables).toEqual([]);
    expect(mockRegisterNovelTickers).not.toHaveBeenCalled();
  });

  it('fail-closed: SMA200 ausente descarta el candidato aunque el setup técnico sea valid', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'NOSMA' }]);
    mockGetTechnicalSummary.mockResolvedValue(tech('NOSMA', { sma200: null, currentPrice: 90 }));
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'valid', riskRewardRatio: 3 });

    const result = await runMarketScreener();

    expect(result.operables).toEqual([]);
  });

  it('acepta un candidato con precio > SMA200 y setup técnico valid', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'GOOD' }]);
    mockGetTechnicalSummary.mockResolvedValue(tech('GOOD', { sma200: 100, currentPrice: 120 }));
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'valid', riskRewardRatio: 3 });
    mockRegisterNovelTickers.mockResolvedValue(1);

    const result = await runMarketScreener();

    expect(result.operables).toEqual(['GOOD']);
    expect(mockRegisterNovelTickers).toHaveBeenCalledWith(['GOOD'], 'screener');
  });

  it('registered refleja el count real de registerNovelTickers, no operables.length (los ya conocidos se filtran ahí)', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'A' }, { symbol: 'B' }]);
    mockGetTechnicalSummary.mockImplementation(async (s: string) => tech(s, { sma200: 100, currentPrice: 120 }));
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'valid', riskRewardRatio: 3 });
    mockRegisterNovelTickers.mockResolvedValue(1); // solo 1 de los 2 operables era nuevo

    const result = await runMarketScreener();

    expect(result.operables).toEqual(['A', 'B']);
    expect(result.registered).toBe(1);
  });

  it('un símbolo sin datos técnicos (getTechnicalSummary tira) se descarta sin abortar el resto del embudo', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'BROKEN' }, { symbol: 'GOOD' }]);
    mockGetTechnicalSummary.mockImplementation(async (s: string) => {
      if (s === 'BROKEN') throw new Error('sin histórico');
      return tech(s, { sma200: 100, currentPrice: 120 });
    });
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'valid', riskRewardRatio: 3 });

    const result = await runMarketScreener();

    expect(result.operables).toEqual(['GOOD']);
  });

  it('un setup técnico invalid sigue descartándose incluso con precio > SMA200', async () => {
    mockFilterScreenerCandidates.mockReturnValue([{ symbol: 'WEAK' }]);
    mockGetTechnicalSummary.mockResolvedValue(tech('WEAK', { sma200: 100, currentPrice: 120 }));
    mockComputeTradeLevels.mockReturnValue({ setupQuality: 'invalid', riskRewardRatio: 3 });

    const result = await runMarketScreener();

    expect(result.operables).toEqual([]);
  });
});
