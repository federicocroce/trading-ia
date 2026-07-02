import { describe, it, expect } from 'vitest';
import { resolveWatchlistStatus, type WatchlistResolveInput } from './watchlist-resolver.js';

const base: WatchlistResolveInput = {
  entryAction: 'BUY',
  entryPrice: 100,
  targetPrice: 120,
  stopLoss: 90,
  currentPrice: 100,
  daysSince: 1,
  horizonDays: 30,
};

describe('resolveWatchlistStatus (long / BUY)', () => {
  it('dentro de ventana, sin tocar nada → live', () => {
    const r = resolveWatchlistStatus({ ...base, currentPrice: 105 });
    expect(r.status).toBe('live');
    expect(r.hitTarget).toBe(false);
    expect(r.hitStop).toBe(false);
  });

  it('toca takeProfit → triggered', () => {
    const r = resolveWatchlistStatus({ ...base, currentPrice: 125 });
    expect(r.status).toBe('triggered');
    expect(r.hitTarget).toBe(true);
  });

  it('precio exactamente en el target cuenta como hit (>=)', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 120 }).status).toBe('triggered');
  });

  it('toca stopLoss → invalidated', () => {
    const r = resolveWatchlistStatus({ ...base, currentPrice: 85 });
    expect(r.status).toBe('invalidated');
    expect(r.hitStop).toBe(true);
  });

  it('precio exactamente en el stop cuenta como hit (<=)', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 90 }).status).toBe('invalidated');
  });

  it('pasó el horizonte sin tocar nada → expired', () => {
    const r = resolveWatchlistStatus({ ...base, currentPrice: 105, daysSince: 30 });
    expect(r.status).toBe('expired');
  });

  it('daysSince justo en el horizonte → expired (>=)', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 105, daysSince: 30, horizonDays: 30 }).status).toBe('expired');
  });

  it('un hit gana sobre el horizonte (target tocado tarde igual triggered)', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 130, daysSince: 99 }).status).toBe('triggered');
  });

  it('un stop gana sobre el horizonte (invalidated, no expired)', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 80, daysSince: 99 }).status).toBe('invalidated');
  });

  it('returnPct = cambio % crudo vs entry', () => {
    expect(resolveWatchlistStatus({ ...base, currentPrice: 110 }).returnPct).toBeCloseTo(10);
    expect(resolveWatchlistStatus({ ...base, currentPrice: 95 }).returnPct).toBeCloseTo(-5);
  });
});

describe('resolveWatchlistStatus (short / SELL invierte la geometría)', () => {
  // SELL: target por DEBAJO del entry, stop por ENCIMA
  const sell: WatchlistResolveInput = { ...base, entryAction: 'SELL', targetPrice: 80, stopLoss: 110 };

  it('precio baja al target → triggered', () => {
    expect(resolveWatchlistStatus({ ...sell, currentPrice: 78 }).status).toBe('triggered');
  });

  it('precio sube al stop → invalidated', () => {
    expect(resolveWatchlistStatus({ ...sell, currentPrice: 112 }).status).toBe('invalidated');
  });

  it('precio entre medio → live', () => {
    expect(resolveWatchlistStatus({ ...sell, currentPrice: 95 }).status).toBe('live');
  });
});

describe('resolveWatchlistStatus (manual sin tesis: targets null)', () => {
  const manual: WatchlistResolveInput = {
    ...base,
    entryAction: 'manual',
    targetPrice: null,
    stopLoss: null,
  };

  it('sin levels nunca triggered/invalidated, aunque el precio se dispare', () => {
    const up = resolveWatchlistStatus({ ...manual, currentPrice: 500 });
    expect(up.status).toBe('live');
    expect(up.hitTarget).toBe(false);
    const down = resolveWatchlistStatus({ ...manual, currentPrice: 1 });
    expect(down.status).toBe('live');
    expect(down.hitStop).toBe(false);
  });

  it('solo expira por horizonte', () => {
    expect(resolveWatchlistStatus({ ...manual, currentPrice: 500, daysSince: 40 }).status).toBe('expired');
  });
});

describe('resolveWatchlistStatus (target o stop parcialmente nulos)', () => {
  it('solo stop definido: puede invalidarse pero no gatillarse', () => {
    const onlyStop: WatchlistResolveInput = { ...base, targetPrice: null };
    expect(resolveWatchlistStatus({ ...onlyStop, currentPrice: 999 }).status).toBe('live');
    expect(resolveWatchlistStatus({ ...onlyStop, currentPrice: 85 }).status).toBe('invalidated');
  });

  it('solo target definido: puede gatillarse pero no invalidarse', () => {
    const onlyTarget: WatchlistResolveInput = { ...base, stopLoss: null };
    expect(resolveWatchlistStatus({ ...onlyTarget, currentPrice: 1 }).status).toBe('live');
    expect(resolveWatchlistStatus({ ...onlyTarget, currentPrice: 125 }).status).toBe('triggered');
  });
});
