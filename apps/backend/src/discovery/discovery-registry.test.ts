import { describe, it, expect, vi, beforeEach } from 'vitest';

// registerNovelTickers toca DB real vía repository.js y un import lazy de db/index.js
// para la eviction — mockeamos ambos (mismo patrón que cycle-radar.service.test.ts)
// para poder probar la decisión de orden (filtrar novel ANTES de evictar) sin red ni DB.
const mockGetActiveDiscoveredSymbols = vi.fn();
const mockGetActiveSymbolList = vi.fn();
const mockUpsertDiscoveredSymbol = vi.fn();
const mockDeactivateExpiredDiscoveries = vi.fn();
const mockInsertSymbol = vi.fn();
const mockGetSymbol = vi.fn();
vi.mock('../db/repository.js', () => ({
  getActiveDiscoveredSymbols: (...args: unknown[]) => mockGetActiveDiscoveredSymbols(...args),
  getActiveSymbolList: (...args: unknown[]) => mockGetActiveSymbolList(...args),
  upsertDiscoveredSymbol: (...args: unknown[]) => mockUpsertDiscoveredSymbol(...args),
  deactivateExpiredDiscoveries: (...args: unknown[]) => mockDeactivateExpiredDiscoveries(...args),
  insertSymbol: (...args: unknown[]) => mockInsertSymbol(...args),
  getSymbol: (...args: unknown[]) => mockGetSymbol(...args),
}));

// Cadena db.update(schema.discoveredSymbols).set({...}).where(...).run() usada solo
// por la eviction — mockeada completa para poder aserir "no se llamó" sin tocar SQLite.
const mockRun = vi.fn();
const mockWhere = vi.fn(() => ({ run: mockRun }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn((..._args: unknown[]) => ({ set: mockSet }));
vi.mock('../db/index.js', () => ({ db: { update: (...args: unknown[]) => mockUpdate(...args) } }));
vi.mock('../db/schema.js', () => ({ discoveredSymbols: {} }));
vi.mock('drizzle-orm', () => ({ inArray: vi.fn() }));

// validateTickers pega a Yahoo (getQuote) — mockeado para que el test de "hay novel,
// evict corre" no dependa de red.
const mockValidateTickers = vi.fn();
vi.mock('./ticker-validator.js', () => ({
  validateTickers: (...args: unknown[]) => mockValidateTickers(...args),
}));

import { initialRelevanceForSource, selectEvictionCandidates, registerNovelTickers, attentionNominationEnabled } from './discovery-registry.js';

describe('initialRelevanceForSource', () => {
  it('screener entra con 30: ya pasó el embudo operable completo (quality bar, SMA200, setup+RR)', () => {
    expect(initialRelevanceForSource('screener')).toBe(30);
  });

  it('las fuentes de noticias/llm entran con el piso de 10 (una mención)', () => {
    expect(initialRelevanceForSource('finnhub')).toBe(10);
    expect(initialRelevanceForSource('yahoo')).toBe(10);
    expect(initialRelevanceForSource('llm')).toBe(10);
  });
});

describe('selectEvictionCandidates', () => {
  const row = (symbol: string, relevanceScore: number | null, lastSeen: string | null) =>
    ({ symbol, relevanceScore, lastSeen });

  it('ordena por relevance ascendente: los de menor relevance se evictan primero', () => {
    const rows = [
      row('ALTA', 50, '2026-07-01T00:00:00.000Z'),
      row('BAJA', 10, '2026-07-03T00:00:00.000Z'),
      row('MEDIA', 30, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol)).toEqual(['BAJA', 'MEDIA']);
  });

  it('a igual relevance desempata por lastSeen más viejo primero', () => {
    const rows = [
      row('RECIENTE', 10, '2026-07-03T00:00:00.000Z'),
      row('VIEJO', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('VIEJO');
  });

  it('un símbolo del screener (30) sobrevive frente a menciones sueltas de noticias (10)', () => {
    const rows = [
      row('NEWS1', 10, '2026-07-03T00:00:00.000Z'),
      row('SCREENER', 30, '2026-07-01T00:00:00.000Z'),
      row('NEWS2', 10, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol).sort()).toEqual(['NEWS1', 'NEWS2']);
  });

  it('relevance null cuenta como 0 (primero en evictarse)', () => {
    const rows = [
      row('SIN_SCORE', null, '2026-07-03T00:00:00.000Z'),
      row('CON_SCORE', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('SIN_SCORE');
  });

  it('no muta el array de entrada y respeta batchSize', () => {
    const rows = [row('A2', 20, null), row('B2', 10, null), row('C2', 30, null)];
    const copia = [...rows];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict).toHaveLength(2);
    expect(rows).toEqual(copia);
  });

  it('batchSize mayor que la cantidad de filas devuelve todas', () => {
    const rows = [row('UNO', 10, null), row('DOS', 20, null)];
    expect(selectEvictionCandidates(rows, 5)).toHaveLength(2);
  });
});

describe('registerNovelTickers — orden filtro-antes-de-evictar', () => {
  const fullRegistry = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      symbol: `SYM${i}`,
      relevanceScore: 10,
      lastSeen: '2026-07-01T00:00:00.000Z',
    }));

  beforeEach(() => {
    mockGetActiveDiscoveredSymbols.mockReset();
    mockGetActiveSymbolList.mockReset();
    mockUpsertDiscoveredSymbol.mockReset();
    mockDeactivateExpiredDiscoveries.mockReset();
    mockInsertSymbol.mockReset();
    mockGetSymbol.mockReset();
    mockUpdate.mockClear();
    mockSet.mockClear();
    mockWhere.mockClear();
    mockRun.mockClear();
  });

  it('con el registry lleno (>=120) y una lista de tickers 100% conocida, no evicta nada y devuelve 0', async () => {
    // Registry al cap: dispararía eviction bajo el orden viejo (evict-primero).
    mockGetActiveDiscoveredSymbols.mockReturnValue(fullRegistry(120));
    // El puente radar nomina lo mismo cada scan: todo lo que llega ya está en el
    // universo vivo (watchlist/portfolio/ETFs).
    mockGetActiveSymbolList.mockReturnValue(['XLF']);

    const registered = await registerNovelTickers(['XLF'], 'radar');

    expect(registered).toBe(0);
    // La aserción que importa: la eviction (db.update sobre discoveredSymbols) NO corrió.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpsertDiscoveredSymbol).not.toHaveBeenCalled();
  });

  it('con el registry lleno y al menos un ticker novel, sí evicta para hacer lugar', async () => {
    mockGetActiveDiscoveredSymbols
      .mockReturnValueOnce(fullRegistry(120)) // lectura inicial (pre-eviction)
      .mockReturnValueOnce(fullRegistry(100)); // relectura post-eviction
    mockGetActiveSymbolList.mockReturnValue([]);
    mockValidateTickers.mockResolvedValue([]); // no importa si valida; lo que se prueba es el orden

    const registered = await registerNovelTickers(['NEWCO'], 'radar');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(registered).toBe(0);
  });
});

describe('attentionNominationEnabled (apagado por defecto desde 2026-07-27)', () => {
  // Los caños de ATENCIÓN (prensa, búsqueda web, LLM) nominaban tickers al universo de scan.
  // Medido contra el índice, ese bloque rinde mediana −6.20% (t=−3.05) — peor que no nominar.
  // Queda apagado por defecto y detrás de una flag para poder re-encenderlo y medirlo, no
  // borrado: apagar es reversible, borrar la capacidad de medir no.
  const KEY = 'DISCOVERY_ATTENTION_NOMINATION';
  beforeEach(() => { delete process.env[KEY]; });

  it('sin la env var: APAGADO (el default es no nominar)', () => {
    expect(attentionNominationEnabled()).toBe(false);
  });

  it('solo "1" lo prende — cualquier otro valor deja apagado (fail-closed)', () => {
    try {
      process.env[KEY] = '1';
      expect(attentionNominationEnabled()).toBe(true);
      for (const v of ['0', 'true', 'yes', '', ' ']) {
        process.env[KEY] = v;
        expect(attentionNominationEnabled()).toBe(false);
      }
    } finally {
      delete process.env[KEY];
    }
  });

  it('se lee LAZY: cambiar la env var después de importar el módulo se refleja', () => {
    try {
      expect(attentionNominationEnabled()).toBe(false);
      process.env[KEY] = '1';
      expect(attentionNominationEnabled()).toBe(true); // inerte si se hubiera leído a nivel módulo
    } finally {
      delete process.env[KEY];
    }
  });
});
