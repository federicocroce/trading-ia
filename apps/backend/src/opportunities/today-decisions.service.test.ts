import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AD-015 — el camino que importa es el que NO se puede provocar a mano: que Yahoo falle.
 * Los tests puros cubren `resolvePositionPrice` y `decidePositionVerb`, pero el bug vivía en el
 * CABLEADO (`getQuotes(...).catch(() => [])` y los `continue` silenciosos). Sin este test, el
 * arreglo quedaba "escrito, sin correr" — el patrón que este repo ya cometió cuatro veces.
 *
 * Mocks solo en la frontera de I/O, igual que market-screener.service.test.ts.
 */
const mockGetQuotes = vi.fn();
const mockGetPortfolioPositions = vi.fn();
const mockGetLatestOpportunityScan = vi.fn();

vi.mock('../shared/yahoo.js', () => ({
  getQuotes: (...a: unknown[]) => mockGetQuotes(...a),
}));
vi.mock('../db/repository.js', () => ({
  getPortfolioPositions: (...a: unknown[]) => mockGetPortfolioPositions(...a),
  getLatestOpportunityScan: (...a: unknown[]) => mockGetLatestOpportunityScan(...a),
  getTodayProposalAppearances: () => new Map(),
  getRecentStopLevels: () => new Map(),
  upsertPortfolioVerdicts: () => 0,
  getActiveTheses: () => [],
}));
vi.mock('../quant/risk.service.js', () => ({
  getRegimes: async () => ({
    us: { assetClass: 'us', label: 'US', regime: 'risk_on', proxy: 'SPY', indexPrice: null, indexSma200: null },
    crypto: { assetClass: 'crypto', label: 'Crypto', regime: 'risk_on', proxy: 'BTC', indexPrice: null, indexSma200: null },
    argentina: { assetClass: 'argentina', label: 'Argentina', regime: 'risk_on', proxy: 'ARGT', indexPrice: null, indexSma200: null },
  }),
  assetClassOf: () => 'us',
}));

const { getTodayDecisions } = await import('./today-decisions.service.js');

function scanCon(opps: unknown[], scannedAt = '2026-07-24T13:42:01.299Z') {
  return { scannedAt, opportunities: JSON.stringify(opps) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPortfolioPositions.mockReturnValue([
    { symbol: 'GGAL', quantity: 100, avgCost: 30 },
    { symbol: 'NEM', quantity: 50, avgCost: 100 },
  ]);
  mockGetLatestOpportunityScan.mockReturnValue(scanCon([
    { symbol: 'GGAL', currentPrice: 48, trailingStop: 47, action: 'HOLD', tradeLevels: {} },
    { symbol: 'NEM', currentPrice: 90, trailingStop: 95, action: 'HOLD', tradeLevels: {} },
  ]));
});

describe('getTodayDecisions cuando Yahoo se cae (AD-015)', () => {
  it('NO inventa un VENDER con el precio del scan: degrada a REVISAR y nombra la fecha', async () => {
    mockGetQuotes.mockRejectedValue(new Error('Yahoo caído'));

    const v = await getTodayDecisions();

    // NEM está a 90 con stop 95 en el scan: con el bug viejo esto salía VENDER ("Cerró bajo tu stop").
    const nem = v.portfolio.find((p) => p.symbol === 'NEM')!;
    expect(nem.verb).toBe('REVISAR');
    expect(nem.warning).toContain('2026-07-24');
    expect(nem.warning).toContain('NO está vigilando');
  });

  it('reporta la cobertura: las dos posiciones quedan con precio viejo', async () => {
    mockGetQuotes.mockRejectedValue(new Error('Yahoo caído'));

    const v = await getTodayDecisions();

    expect(v.portfolioCoverage.total).toBe(2);
    expect(v.portfolioCoverage.stalePriced).toBe(2);
    expect(v.portfolioCoverage.dropped).toEqual([]);
    expect(v.portfolioCoverage.stopsAsOf).toBe('2026-07-24');
  });

  it('con cotización viva vuelve a decidir normal — el gate no se come el caso sano', async () => {
    mockGetQuotes.mockResolvedValue([
      { symbol: 'GGAL', current: 48.5, previousClose: 48, marketState: 'CLOSED' },
      { symbol: 'NEM', current: 90, previousClose: 91, marketState: 'CLOSED' },
    ]);

    const v = await getTodayDecisions();

    expect(v.portfolioCoverage.stalePriced).toBe(0);
    expect(v.portfolio.find((p) => p.symbol === 'NEM')!.verb).toBe('VENDER');
  });
});

describe('getTodayDecisions con una posición imposible de valuar (AD-015)', () => {
  it('la REPORTA en dropped en vez de hacerla desaparecer', async () => {
    mockGetQuotes.mockResolvedValue([]);
    mockGetLatestOpportunityScan.mockReturnValue(scanCon([
      { symbol: 'GGAL', currentPrice: 48, trailingStop: 47, action: 'HOLD', tradeLevels: {} },
    ])); // NEM no está en el scan y no tiene quote → no se puede valuar

    const v = await getTodayDecisions();

    expect(v.portfolio.map((p) => p.symbol)).toEqual(['GGAL']);
    expect(v.portfolioCoverage.dropped).toHaveLength(1);
    expect(v.portfolioCoverage.dropped[0].symbol).toBe('NEM');
    expect(v.portfolioCoverage.valueIsPartial).toBe(true);
    // Invariante: nada se pierde por el camino.
    expect(v.portfolioCoverage.evaluated + v.portfolioCoverage.dropped.length).toBe(v.portfolioCoverage.total);
  });

  it('avgCost inválido también se reporta, no se saltea', async () => {
    mockGetQuotes.mockResolvedValue([{ symbol: 'GGAL', current: 48.5, previousClose: 48, marketState: 'CLOSED' }]);
    mockGetPortfolioPositions.mockReturnValue([
      { symbol: 'GGAL', quantity: 100, avgCost: 30 },
      { symbol: 'RARO', quantity: 10, avgCost: 0 },
    ]);

    const v = await getTodayDecisions();

    expect(v.portfolioCoverage.dropped.map((d) => d.symbol)).toContain('RARO');
    expect(v.portfolioCoverage.evaluated + v.portfolioCoverage.dropped.length).toBe(v.portfolioCoverage.total);
  });
});
