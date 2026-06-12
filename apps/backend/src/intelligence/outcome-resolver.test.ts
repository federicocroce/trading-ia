import { describe, it, expect } from 'vitest';
import {
  resolveAlertOutcome,
  resolveCausalOutcome,
  type PriceCandle,
  type AlertResolutionInput,
} from './outcome-resolver.js';

function candle(date: string, high: number, low: number, close: number): PriceCandle {
  return { date, high, low, close };
}

const baseAlert: AlertResolutionInput = {
  entryPrice: 100,
  takeProfit: 105,
  stopLoss: 95,
  firstSeenDate: '2026-06-01',
};

describe('resolveAlertOutcome', () => {
  it('marks triggered when a later candle hits the take-profit', () => {
    const candles = [candle('2026-06-02', 106, 99, 105)];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-05');
    expect(r.outcome).toBe('triggered');
    expect(r.resolutionPrice).toBe(105);
    expect(r.resolvedDate).toBe('2026-06-02');
    expect(r.resolutionReturn).toBeCloseTo(5);
  });

  it('marks missed when a later candle breaks the stop-loss', () => {
    const candles = [candle('2026-06-02', 101, 94, 96)];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-05');
    expect(r.outcome).toBe('missed');
    expect(r.resolutionPrice).toBe(95);
    expect(r.resolutionReturn).toBeCloseTo(-5);
  });

  it('is conservative (missed) when one candle straddles both target and stop', () => {
    const candles = [candle('2026-06-02', 106, 94, 100)];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-05');
    expect(r.outcome).toBe('missed');
  });

  it('ignores the setup day itself (firstSeenDate) when detecting hits', () => {
    const candles = [
      candle('2026-06-01', 110, 90, 100), // setup day — must be excluded
      candle('2026-06-03', 103, 99, 101), // no hit
    ];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-04');
    expect(r.outcome).toBe('pending'); // nothing hit after setup day, still inside horizon
  });

  it('expires when the horizon passes with no hit', () => {
    const candles = [
      candle('2026-06-05', 103, 98, 101),
      candle('2026-06-12', 104, 97, 102),
    ];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-20'); // 19 days > horizon
    expect(r.outcome).toBe('expired');
    expect(r.resolutionPrice).toBe(102); // last close
    expect(r.resolutionReturn).toBeCloseTo(2);
  });

  it('stays pending while inside the horizon with no hit', () => {
    const candles = [candle('2026-06-02', 103, 98, 101)];
    const r = resolveAlertOutcome(baseAlert, candles, '2026-06-04'); // 3 days < horizon
    expect(r.outcome).toBe('pending');
  });

  it('falls back to ±4% bands when no take-profit/stop are set', () => {
    const noLevels: AlertResolutionInput = { entryPrice: 100, firstSeenDate: '2026-06-01' };
    const candles = [candle('2026-06-02', 105, 99, 104)]; // high 105 >= 104 (+4%)
    const r = resolveAlertOutcome(noLevels, candles, '2026-06-05');
    expect(r.outcome).toBe('triggered');
    expect(r.resolutionPrice).toBeCloseTo(104);
  });
});

describe('resolveCausalOutcome', () => {
  const eventDate = '2026-06-01';

  it('marks correct when a positive call matches an upward move beyond threshold', () => {
    const candles = [candle('2026-06-08', 0, 0, 104)];
    const r = resolveCausalOutcome('positive', 100, candles, '2026-06-10', eventDate);
    expect(r.outcome).toBe('correct');
    expect(r.resolutionReturn).toBeCloseTo(4);
  });

  it('marks incorrect when a positive call is contradicted by a drop', () => {
    const candles = [candle('2026-06-08', 0, 0, 96)];
    const r = resolveCausalOutcome('positive', 100, candles, '2026-06-10', eventDate);
    expect(r.outcome).toBe('incorrect');
  });

  it('marks correct when a negative call matches a downward move', () => {
    const candles = [candle('2026-06-08', 0, 0, 96)];
    const r = resolveCausalOutcome('negative', 100, candles, '2026-06-10', eventDate);
    expect(r.outcome).toBe('correct');
  });

  it('marks neutral when the move is within the noise threshold', () => {
    const candles = [candle('2026-06-08', 0, 0, 101)];
    const r = resolveCausalOutcome('positive', 100, candles, '2026-06-10', eventDate);
    expect(r.outcome).toBe('neutral');
  });

  it('stays pending before the horizon elapses', () => {
    const candles = [candle('2026-06-02', 0, 0, 104)];
    const r = resolveCausalOutcome('positive', 100, candles, '2026-06-03', eventDate); // 2d < 5
    expect(r.outcome).toBe('pending');
  });

  it('stays pending when there are no candles to evaluate', () => {
    const r = resolveCausalOutcome('positive', 100, [], '2026-06-10', eventDate);
    expect(r.outcome).toBe('pending');
  });
});
