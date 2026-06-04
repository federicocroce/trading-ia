import { describe, it, expect } from 'vitest';
import { buildSectorImpactMap, type SectorMapOpportunity } from './sector-impact-map.service.js';
import type { MacroEventRow } from '../db/repository.js';

const sectorOf = (s: string): string | null => {
  const m: Record<string, string> = {
    YPF: 'us-energy', PAM: 'us-energy', EOG: 'us-energy',
    NEM: 'commodities', GLD: 'commodities',
  };
  return m[s] ?? null;
};

const opps = (rows: Array<[string, string, string, number]>): SectorMapOpportunity[] =>
  rows.map(([symbol, sector, action, score]) => ({
    symbol, sector, sectorLabel: sector, action: action as any, opportunityScore: score,
  }));

describe('buildSectorImpactMap', () => {
  it('groups by sector with winners/losers and tags holdings', () => {
    const opportunities = opps([
      ['EOG', 'us-energy', 'BUY', 61],
      ['YPF', 'us-energy', 'SELL', 40],
      ['NEM', 'commodities', 'BUY', 59],
    ]);
    const causal: MacroEventRow[] = [
      { eventId: 'e1', event: 'Riesgo Argentina', category: 'EM', magnitude: 'high',
        relatedEventIds: [], chains: [
          { eventId: 'e1', ticker: 'YPF', category: 'EM', direction: 'negative', impact: 'direct', reason: '' },
        ] },
    ];
    const map = buildSectorImpactMap(opportunities, causal, ['YPF', 'NEM'], sectorOf);

    const energy = map.find(s => s.sector === 'us-energy')!;
    expect(energy.winners.map(w => w.symbol)).toContain('EOG');
    expect(energy.losers.map(l => l.symbol)).toContain('YPF');
    expect(energy.drivers[0]).toMatchObject({ event: 'Riesgo Argentina', direction: 'negative', magnitude: 'high' });
    // YPF is a holding on the loser side
    expect(energy.yourHoldings).toContainEqual({ symbol: 'YPF', side: 'loser' });
    // EOG winner has the inPortfolio flag false
    expect(energy.winners.find(w => w.symbol === 'EOG')?.inPortfolio).toBe(false);

    const comm = map.find(s => s.sector === 'commodities')!;
    expect(comm.winners.map(w => w.symbol)).toContain('NEM');
    expect(comm.yourHoldings).toContainEqual({ symbol: 'NEM', side: 'winner' });
  });

  it('falls back to BUY/SELL balance with low confidence when no causal drivers', () => {
    const map = buildSectorImpactMap(
      opps([['EOG', 'us-energy', 'BUY', 61], ['COP', 'us-energy', 'BUY', 58]]),
      [], [], sectorOf,
    );
    const energy = map.find(s => s.sector === 'us-energy')!;
    expect(energy.drivers).toEqual([]);
    expect(energy.confidence).toBe('low');
    expect(energy.netImpact).toBe('positive'); // 2 BUY, 0 SELL
  });

  it('marks mixed when a sector has both positive and negative drivers', () => {
    const causal: MacroEventRow[] = [
      { eventId: 'e1', event: 'Petróleo sube', category: 'oil', magnitude: 'high', relatedEventIds: [],
        chains: [{ eventId: 'e1', ticker: 'EOG', category: 'oil', direction: 'positive', impact: 'direct', reason: '' }] },
      { eventId: 'e2', event: 'Riesgo Argentina', category: 'EM', magnitude: 'high', relatedEventIds: [],
        chains: [{ eventId: 'e2', ticker: 'YPF', category: 'EM', direction: 'negative', impact: 'direct', reason: '' }] },
    ];
    const map = buildSectorImpactMap(
      opps([['EOG', 'us-energy', 'BUY', 61], ['YPF', 'us-energy', 'HOLD', 50]]),
      causal, [], sectorOf,
    );
    expect(map.find(s => s.sector === 'us-energy')!.netImpact).toBe('mixed');
  });

  it('returns [] for empty opportunities', () => {
    expect(buildSectorImpactMap([], [], [], sectorOf)).toEqual([]);
  });

  it('caps winners at 6', () => {
    const rows = Array.from({ length: 9 }, (_, i): [string, string, string, number] =>
      [`S${i}`, 'us-tech', 'BUY', 60 - i]);
    const map = buildSectorImpactMap(opps(rows), [], [], () => 'us-tech');
    expect(map.find(s => s.sector === 'us-tech')!.winners.length).toBe(6);
  });
});
