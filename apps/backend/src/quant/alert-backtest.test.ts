import { describe, it, expect } from 'vitest';
import { summarizeAlertEdge, type BarSample } from './alert-backtest.js';

const s = (fired: boolean, outcome: BarSample['outcome'], returnPct: number): BarSample => ({ fired, outcome, returnPct });

describe('summarizeAlertEdge', () => {
  it('returns zeroed stats for no samples', () => {
    const r = summarizeAlertEdge([]);
    expect(r.alerts.n).toBe(0);
    expect(r.baseline.n).toBe(0);
    expect(r.edgeWinRate).toBe(0);
    expect(r.edgeReturn).toBe(0);
  });

  it('splits alert bars from the all-bars baseline', () => {
    const samples = [
      s(true, 'triggered', 5),
      s(true, 'missed', -3),
      s(false, 'triggered', 4),
      s(false, 'expired', 1),
    ];
    const r = summarizeAlertEdge(samples);
    expect(r.alerts.n).toBe(2);     // solo las fired
    expect(r.baseline.n).toBe(4);   // todas
  });

  it('computes winRate as triggered/(triggered+missed), excluding expired', () => {
    const samples = [
      s(true, 'triggered', 5),
      s(true, 'missed', -3),
      s(true, 'expired', 0), // no cuenta en winRate
    ];
    const r = summarizeAlertEdge(samples);
    expect(r.alerts.winRate).toBe(50); // 1 / (1+1)
    expect(r.alerts.triggered).toBe(1);
    expect(r.alerts.missed).toBe(1);
    expect(r.alerts.expired).toBe(1);
  });

  it('computes avgReturn over all samples in the group', () => {
    const samples = [s(true, 'triggered', 5), s(true, 'missed', -3)];
    const r = summarizeAlertEdge(samples);
    expect(r.alerts.avgReturn).toBe(1); // (5 + -3) / 2
  });

  it('computes edge as alerts minus baseline', () => {
    const samples = [
      s(true, 'triggered', 5),
      s(true, 'missed', -3),
      s(false, 'triggered', 4),
      s(false, 'expired', 1),
    ];
    const r = summarizeAlertEdge(samples);
    // baseline: triggered=2 missed=1 → winRate 67; avgReturn (5-3+4+1)/4 = 1.75
    // alerts:   triggered=1 missed=1 → winRate 50; avgReturn (5-3)/2 = 1
    expect(r.baseline.winRate).toBe(67);
    expect(r.baseline.avgReturn).toBe(1.75);
    expect(r.edgeWinRate).toBe(50 - 67);
    expect(r.edgeReturn).toBe(-0.75);
  });
});
