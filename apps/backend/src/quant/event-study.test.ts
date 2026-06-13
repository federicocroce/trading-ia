import { describe, it, expect } from 'vitest';
import { windowReturnPct, detectEventDates, meanStats, edgeTStat, type Candle, type EventDef } from './event-study.js';

function seq(closes: number[]): Candle[] {
  return closes.map((close, i) => ({ date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), close }));
}

describe('windowReturnPct', () => {
  it('retorno % sobre la ventana', () => {
    expect(windowReturnPct([100, 101, 102, 103, 110], 4, 4)).toBeCloseTo(10);
  });
  it('null si no hay suficiente ventana', () => {
    expect(windowReturnPct([100, 101], 1, 4)).toBeNull();
  });
});

describe('detectEventDates (eventos definidos por precio, con debounce)', () => {
  const def: EventDef = { type: 'spike_up', proxy: 'X', window: 2, direction: 'up', thresholdPct: 5, label: 'spike' };

  it('detecta el primer día del shock y no lo re-cuenta (cooldown = ventana)', () => {
    // sube 10% en 2 días en d2; sigue alto pero no debe re-disparar enseguida
    const candles = seq([100, 100, 110, 111, 112]);
    const dates = detectEventDates(candles, def);
    expect(dates.length).toBe(1);
    expect(dates[0]).toBe(candles[2].date);
  });

  it('no dispara si el movimiento no llega al umbral', () => {
    expect(detectEventDates(seq([100, 100, 102, 103]), def)).toEqual([]);
  });

  it('dirección down dispara con caídas', () => {
    const down: EventDef = { ...def, direction: 'down', type: 'spike_down' };
    const dates = detectEventDates(seq([100, 100, 90, 89]), down);
    expect(dates.length).toBe(1);
  });
});

describe('meanStats', () => {
  it('media, win-rate y n', () => {
    const r = meanStats([2, -1, 3]);
    expect(r.mean).toBeCloseTo(1.33, 1);
    expect(r.winRate).toBe(67);
    expect(r.n).toBe(3);
  });
  it('vacío → ceros', () => {
    expect(meanStats([]).n).toBe(0);
  });
});

describe('edgeTStat (¿la reacción supera al baseline más allá del ruido?)', () => {
  it('valores claramente sobre el baseline con poca varianza → |t| alto', () => {
    expect(Math.abs(edgeTStat([5, 5.2, 4.8, 5.1, 4.9], 0))).toBeGreaterThan(5);
  });
  it('valores iguales al baseline → t ≈ 0', () => {
    expect(Math.abs(edgeTStat([2, 2, 2, 2], 2))).toBeLessThan(0.5);
  });
});
