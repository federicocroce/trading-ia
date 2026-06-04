import type {
  SignalAction, SectorImpactMapEntry, SectorImpactTicker, SectorDriver, SectorImpactDirection,
  Opportunity,
} from '@trading/shared';
import type { MacroEventRow } from '../db/repository.js';
import { getLatestOpportunityScan, getPortfolioPositions, getCausalMapByDate } from '../db/repository.js';
import { getSectorForSymbolDynamic } from '../discovery/discovery-registry.js';

/** Minimal opportunity fields the map needs (keeps the function testable). */
export interface SectorMapOpportunity {
  symbol: string;
  sector: string;
  sectorLabel: string;
  action: SignalAction;
  opportunityScore: number;
}

const MAX_PER_SIDE = 6;
const MAG_WEIGHT: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };

/**
 * Synthesizes the latest scan + causal events + portfolio into a per-sector impact map.
 * Pure: `sectorOf` resolves the sector of a causal ticker not present in the scan.
 */
export function buildSectorImpactMap(
  opportunities: SectorMapOpportunity[],
  causalEvents: MacroEventRow[],
  portfolioSymbols: string[],
  sectorOf: (symbol: string) => string | null,
): SectorImpactMapEntry[] {
  if (opportunities.length === 0) return [];

  const held = new Set(portfolioSymbols.map(s => s.toUpperCase()));
  const symbolSector = new Map<string, { sector: string; label: string }>();

  // Group opportunities by sector.
  const bySector = new Map<string, { label: string; opps: SectorMapOpportunity[] }>();
  for (const o of opportunities) {
    symbolSector.set(o.symbol.toUpperCase(), { sector: o.sector, label: o.sectorLabel });
    const g = bySector.get(o.sector) ?? { label: o.sectorLabel, opps: [] };
    g.opps.push(o);
    bySector.set(o.sector, g);
  }

  // Collect drivers per sector from causal events (dedup by event per sector).
  type DriverAgg = { driver: SectorDriver; weighted: number };
  const driversBySector = new Map<string, Map<string, DriverAgg>>();
  for (const evt of causalEvents) {
    for (const chain of evt.chains) {
      const sym = chain.ticker.toUpperCase();
      const sector = symbolSector.get(sym)?.sector ?? sectorOf(chain.ticker) ?? null;
      if (!sector) continue;
      const perSector = driversBySector.get(sector) ?? new Map<string, DriverAgg>();
      const key = `${evt.eventId}:${chain.direction}`;
      if (!perSector.has(key)) {
        perSector.set(key, {
          driver: { event: evt.event, category: evt.category, direction: chain.direction, magnitude: evt.magnitude },
          weighted: (chain.direction === 'positive' ? 1 : -1) * MAG_WEIGHT[evt.magnitude],
        });
      }
      driversBySector.set(sector, perSector);
    }
  }

  const entries: SectorImpactMapEntry[] = [];
  for (const [sector, { label, opps }] of bySector) {
    const toTicker = (o: SectorMapOpportunity): SectorImpactTicker => ({
      symbol: o.symbol, action: o.action, score: o.opportunityScore,
      inPortfolio: held.has(o.symbol.toUpperCase()),
    });

    const winners = opps.filter(o => o.action === 'BUY')
      .sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, MAX_PER_SIDE).map(toTicker);
    const losers = opps.filter(o => o.action === 'SELL')
      .sort((a, b) => a.opportunityScore - b.opportunityScore).slice(0, MAX_PER_SIDE).map(toTicker);

    const winnerSet = new Set(winners.map(w => w.symbol.toUpperCase()));
    const loserSet = new Set(losers.map(l => l.symbol.toUpperCase()));
    const yourHoldings = opps
      .filter(o => held.has(o.symbol.toUpperCase()))
      .map(o => ({
        symbol: o.symbol,
        side: (winnerSet.has(o.symbol.toUpperCase()) ? 'winner'
          : loserSet.has(o.symbol.toUpperCase()) ? 'loser' : 'neutral') as 'winner' | 'loser' | 'neutral',
      }));

    const drivers = [...(driversBySector.get(sector)?.values() ?? [])].map(d => d.driver);

    // Net impact + confidence.
    let netImpact: SectorImpactDirection;
    let confidence: 'high' | 'medium' | 'low';
    if (drivers.length > 0) {
      const pos = drivers.some(d => d.direction === 'positive');
      const neg = drivers.some(d => d.direction === 'negative');
      const sum = [...(driversBySector.get(sector)?.values() ?? [])].reduce((s, d) => s + d.weighted, 0);
      netImpact = pos && neg ? 'mixed' : sum > 0 ? 'positive' : sum < 0 ? 'negative' : 'neutral';
      const topMag = drivers.reduce((m, d) => Math.max(m, MAG_WEIGHT[d.magnitude]), 0);
      confidence = topMag >= 3 ? 'high' : topMag === 2 ? 'medium' : 'low';
    } else {
      // Fallback: scan BUY/SELL balance, weak signal.
      const buys = opps.filter(o => o.action === 'BUY').length;
      const sells = opps.filter(o => o.action === 'SELL').length;
      netImpact = buys > sells ? 'positive' : sells > buys ? 'negative' : 'neutral';
      confidence = 'low';
    }

    entries.push({ sector, label, netImpact, confidence, drivers, winners, losers, yourHoldings });
  }

  // Sort: sectors with your holdings first, then by driver count, then by name.
  return entries.sort((a, b) =>
    (b.yourHoldings.length > 0 ? 1 : 0) - (a.yourHoldings.length > 0 ? 1 : 0)
    || b.drivers.length - a.drivers.length
    || a.sector.localeCompare(b.sector));
}

/**
 * Wires the real data sources and computes the sector impact map on the fly from the
 * latest scan + causal map (aligned to the scan's date) + portfolio. No persistence.
 */
export function getSectorImpactMap(): SectorImpactMapEntry[] {
  const scan = getLatestOpportunityScan();
  if (!scan?.opportunities) return [];
  let opps: Opportunity[];
  try { opps = JSON.parse(scan.opportunities) as Opportunity[]; } catch { return []; }

  const scanDate = scan.scannedAt.slice(0, 10);
  let causal = getCausalMapByDate(scanDate);
  if (causal.length === 0) causal = getCausalMapByDate(new Date().toISOString().slice(0, 10));

  const portfolioSymbols = getPortfolioPositions().map(p => p.symbol);
  return buildSectorImpactMap(
    opps.map(o => ({
      symbol: o.symbol, sector: o.sector, sectorLabel: o.sectorLabel,
      action: o.action, opportunityScore: o.opportunityScore,
    })),
    causal,
    portfolioSymbols,
    (s) => getSectorForSymbolDynamic(s),
  );
}
