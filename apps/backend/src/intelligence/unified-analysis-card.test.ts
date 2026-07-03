import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCompactCard } from './unified-analysis.service.js';
import type { Opportunity } from '@trading/shared';

// Mocks SOLO de la frontera de I/O (DB/clasificación) para poder controlar qué nombre de
// empresa resuelve buildCompactCard() sin tocar una BD real.
const mockGetSymbol = vi.fn();
const mockGetClassificationForSymbol = vi.fn();

vi.mock('../db/repository.js', () => ({
  getPortfolioPositions: vi.fn(() => []),
  getSymbol: (...args: unknown[]) => mockGetSymbol(...args),
  getActiveDiscoveredSymbols: vi.fn(() => []),
}));
vi.mock('../discovery/discovery-registry.js', () => ({
  getClassificationForSymbol: (...args: unknown[]) => mockGetClassificationForSymbol(...args),
}));

function makeOpp(symbol: string): Opportunity {
  return {
    symbol,
    currentPrice: 42.5,
    action: 'BUY',
    opportunityScore: 80,
    inPortfolio: false,
    passedAntiHype: true,
  } as unknown as Opportunity;
}

describe('buildCompactCard — identidad del símbolo', () => {
  beforeEach(() => {
    mockGetSymbol.mockReset();
    mockGetClassificationForSymbol.mockReset();
  });

  it('incluye el nombre real desde la tabla symbols (watchlist/portfolio)', () => {
    mockGetSymbol.mockReturnValueOnce({ name: 'Liberty Broadband Corporation' });
    mockGetClassificationForSymbol.mockReturnValueOnce(undefined);

    const card = buildCompactCard(makeOpp('LBRDA'), []);

    expect(card).toContain('LBRDA (Liberty Broadband Corporation) $42.50');
  });

  it('cuando no está en symbols, cae al nombre de la clasificación/discovery', () => {
    mockGetSymbol.mockReturnValueOnce(undefined);
    mockGetClassificationForSymbol.mockReturnValueOnce({ name: 'Construction Partners, Inc.' });

    const card = buildCompactCard(makeOpp('ROAD'), []);

    // ROAD es Construction Partners — nunca Liberty Broadband/Comcast (caso real del bug).
    expect(card).toContain('ROAD (Construction Partners, Inc.) $42.50');
    expect(card).not.toContain('Broadband');
    expect(card).not.toContain('Comcast');
  });

  it('si no hay nombre en ningún lado, usa el símbolo como fallback', () => {
    mockGetSymbol.mockReturnValueOnce(undefined);
    mockGetClassificationForSymbol.mockReturnValueOnce(undefined);

    const card = buildCompactCard(makeOpp('XYZ'), []);

    expect(card).toContain('XYZ (XYZ) $42.50');
  });

  it('no revienta el batch si la resolución de nombre tira una excepción', () => {
    mockGetSymbol.mockImplementationOnce(() => {
      throw new Error('DB down');
    });

    const card = buildCompactCard(makeOpp('AAPL'), []);

    expect(card).toContain('AAPL (AAPL) $42.50');
  });
});
