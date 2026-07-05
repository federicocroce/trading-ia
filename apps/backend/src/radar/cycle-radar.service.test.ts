import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetHistoricalQuotes = vi.fn();
const mockGetKeyStats = vi.fn();
vi.mock('../shared/yahoo.js', () => ({
  getHistoricalQuotes: (...args: unknown[]) => mockGetHistoricalQuotes(...args),
  getKeyStats: (...args: unknown[]) => mockGetKeyStats(...args),
}));

const mockInsert = vi.fn();
const mockDeleteForDate = vi.fn();
const mockSharesHistory = vi.fn();
vi.mock('../db/repository.js', () => ({
  insertCycleRadarSnapshots: (...args: unknown[]) => mockInsert(...args),
  deleteCycleRadarSnapshotsForDate: (...args: unknown[]) => mockDeleteForDate(...args),
  getRadarSharesHistory: (...args: unknown[]) => mockSharesHistory(...args),
}));

import { runCycleRadar, RADAR_UNIVERSE } from './cycle-radar.service.js';

// 350 velas alcistas sintéticas (suficientes para SMA200 y ret6m)
const velas = (desde: number, hasta: number, n = 350) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2025-01-${(i % 28) + 1}`, open: 0, high: 0, low: 0, volume: 0,
    close: desde + ((hasta - desde) * i) / (n - 1),
  }));

beforeEach(() => {
  mockGetHistoricalQuotes.mockReset();
  mockGetKeyStats.mockReset();
  mockInsert.mockReset();
  mockDeleteForDate.mockReset();
  mockSharesHistory.mockReset();
  mockGetKeyStats.mockResolvedValue({ sharesOutstanding: 1000000 });
  mockSharesHistory.mockReturnValue([]);
});

describe('runCycleRadar', () => {
  it('persiste un snapshot por canasta del universo con delete previo (idempotente)', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    const r = await runCycleRadar();
    expect(mockDeleteForDate).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const rows = mockInsert.mock.calls[0][0];
    expect(rows).toHaveLength(RADAR_UNIVERSE.length);
    expect(r.persisted).toBe(RADAR_UNIVERSE.length);
    expect(r.skipped).toEqual([]);
    // serie alcista sostenida => tendencia o extendido, jamás null silencioso
    expect(rows.every((row: { cycleState: string | null }) => row.cycleState !== null)).toBe(true);
  });

  it('si SPY falla, aborta honesto sin persistir nada (fail-closed)', async () => {
    mockGetHistoricalQuotes.mockRejectedValue(new Error('yahoo caido'));
    const r = await runCycleRadar();
    expect(r.persisted).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDeleteForDate).not.toHaveBeenCalled();
  });

  it('el fallo de una canasta la manda a skipped sin frenar al resto', async () => {
    mockGetHistoricalQuotes.mockImplementation((symbol: string) => {
      if (symbol === RADAR_UNIVERSE[0].symbol) return Promise.reject(new Error('timeout'));
      return Promise.resolve(velas(100, 200));
    });
    const r = await runCycleRadar();
    expect(r.persisted).toBe(RADAR_UNIVERSE.length - 1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain(RADAR_UNIVERSE[0].symbol);
  });

  it('getKeyStats que falla no voltea la canasta: sharesOutstanding null y flow null', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    mockGetKeyStats.mockResolvedValue({ sharesOutstanding: null });
    await runCycleRadar();
    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].sharesOutstanding).toBeNull();
    expect(rows[0].flowDelta20d).toBeNull();
  });

  it('el universo tiene 23 canastas con labels y categorias validas', () => {
    expect(RADAR_UNIVERSE).toHaveLength(23);
    expect(RADAR_UNIVERSE.every(b => b.label.length > 0 && ['pais', 'sector'].includes(b.categoria))).toBe(true);
    expect(RADAR_UNIVERSE.some(b => b.symbol === 'SPY')).toBe(false); // SPY es benchmark, no canasta
  });

  it('pasa la fecha del dia a getRadarSharesHistory para excluir el snapshot de hoy en re-corridas', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    const r = await runCycleRadar();
    expect(mockSharesHistory).toHaveBeenCalledWith(RADAR_UNIVERSE[0].symbol, 21, r.date);
  });

  it('con historia acumulada computa flowDelta20d end-to-end (+10% con base 1000 y actual 1100)', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    mockGetKeyStats.mockResolvedValue({ sharesOutstanding: 1100 });
    mockSharesHistory.mockReturnValue(Array(20).fill(1000));
    await runCycleRadar();
    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].flowDelta20d).toBeCloseTo(10, 5);
  });
});
