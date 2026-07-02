import { describe, it, expect } from 'vitest';
import {
  resolveAlertOutcome,
  resolveCausalOutcome,
  resolveTrackedSignal,
  type PriceCandle,
  type AlertResolutionInput,
  type TrackedSignalInput,
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

describe('resolveTrackedSignal', () => {
  const mkCandle = (date: string, close: number, high = close, low = close) => ({ date, high, low, close });

  it('WATCH que colapsa es LOSS, no win (caso SDOT)', () => {
    // SDOT: WATCH a $24.58, target $60.33, stop $0.75 — cayó a $6.77
    const input: TrackedSignalInput = {
      action: 'WATCH', entryPrice: 24.58, targetPrice: 60.33, stopLoss: 0.75, signalDate: '2026-06-11',
    };
    const candles = [mkCandle('2026-06-16', 21.5), mkCandle('2026-06-23', 9.25), mkCandle('2026-07-11', 6.77)];
    const res = resolveTrackedSignal(input, candles, '2026-07-12');
    expect(res.outcome).toBe('loss');
    expect(res.hitTarget).toBe(false);
  });

  it('BUY que toca el stop en el camino es LOSS aunque después rebote', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 120, stopLoss: 92, signalDate: '2026-06-01',
    };
    const candles = [mkCandle('2026-06-05', 95, 96, 90), mkCandle('2026-06-20', 118)];
    const res = resolveTrackedSignal(input, candles, '2026-06-21');
    expect(res.outcome).toBe('loss');
    expect(res.hitStop).toBe(true);
    expect(res.resolvedDate).toBe('2026-06-05');
  });

  it('BUY que toca target sin tocar stop es WIN en la fecha del hit', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 110, stopLoss: 92, signalDate: '2026-06-01',
    };
    const candles = [mkCandle('2026-06-03', 104), mkCandle('2026-06-08', 109, 111, 107)];
    const res = resolveTrackedSignal(input, candles, '2026-06-10');
    expect(res.outcome).toBe('win');
    expect(res.hitTarget).toBe(true);
    expect(res.resolvedDate).toBe('2026-06-08');
  });

  it('vela que toca target y stop el mismo día resuelve conservador: LOSS', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 108, stopLoss: 94, signalDate: '2026-06-01',
    };
    const candles = [mkCandle('2026-06-02', 100, 109, 93)];
    const res = resolveTrackedSignal(input, candles, '2026-06-03');
    expect(res.outcome).toBe('loss');
  });

  it('SELL gana si el precio baja (medido como short)', () => {
    const input: TrackedSignalInput = {
      action: 'SELL', entryPrice: 100, targetPrice: null, stopLoss: null, signalDate: '2026-06-01',
    };
    const candles = [mkCandle('2026-07-02', 90)];
    const res = resolveTrackedSignal(input, candles, '2026-07-02');
    expect(res.outcome).toBe('win');
    expect(res.resolutionReturn).toBeCloseTo(10);
  });

  it('sin hits y dentro del horizonte queda PENDING', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 120, stopLoss: 90, signalDate: '2026-06-25',
    };
    const candles = [mkCandle('2026-06-28', 101)];
    const res = resolveTrackedSignal(input, candles, '2026-06-30');
    expect(res.outcome).toBe('pending');
  });

  it('sin hits, horizonte vencido y retorno dentro de la banda ±2% es NEUTRAL', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: null, stopLoss: null, signalDate: '2026-05-01',
    };
    const candles = [mkCandle('2026-06-05', 101)];
    const res = resolveTrackedSignal(input, candles, '2026-06-10');
    expect(res.outcome).toBe('neutral');
  });

  it('retorno implausible (>200%) marca INVALID (split sin ajustar / feed roto)', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 16.21, targetPrice: null, stopLoss: null, signalDate: '2026-06-13',
    };
    const candles = [mkCandle('2026-07-15', 72.0)]; // +344% — el caso real de SDOT en la DB
    const res = resolveTrackedSignal(input, candles, '2026-07-16');
    expect(res.outcome).toBe('invalid');
  });

  it('target incoherente con la dirección se ignora (long con target bajo el entry)', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 80, stopLoss: null, signalDate: '2026-05-01',
    };
    const candles = [mkCandle('2026-05-10', 95, 96, 79)];
    // Si NO se ignorara, current <= 80 en low daría hitTarget=win con el precio cayendo
    const res = resolveTrackedSignal(input, candles, '2026-06-05');
    expect(res.outcome).toBe('loss');
    expect(res.hitTarget).toBe(false);
  });

  it('hit legítimo temprano gana aunque una vela posterior esté corrupta', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 16.21, targetPrice: 20, stopLoss: null, signalDate: '2026-06-13',
    };
    const candles = [mkCandle('2026-06-20', 21, 22, 20), mkCandle('2026-07-15', 72)];
    const res = resolveTrackedSignal(input, candles, '2026-07-16');
    expect(res.outcome).toBe('win');
  });

  it('vela corrupta ANTES de cualquier hit invalida el tracking (falso hit por split)', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 16.21, targetPrice: 46.4, stopLoss: null, signalDate: '2026-06-13',
    };
    const candles = [mkCandle('2026-06-18', 72, 72, 70)];
    const res = resolveTrackedSignal(input, candles, '2026-06-19');
    expect(res.outcome).toBe('invalid');
  });

  it('sin velas posteriores y horizonte vencido es invalid', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: null, stopLoss: null, signalDate: '2026-01-01',
    };
    const res = resolveTrackedSignal(input, [], '2026-03-01');
    expect(res.outcome).toBe('invalid');
  });
});
