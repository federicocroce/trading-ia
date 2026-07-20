import { describe, it, expect } from 'vitest';
import { selectRadarNominees, RADAR_CONSTITUENTS } from './radar-constituents.js';

const row = (symbol: string, cycleState: string | null, categoria = 'sector') =>
  ({ symbol, categoria, cycleState });

describe('selectRadarNominees', () => {
  it('sector girando nomina sus constituyentes', () => {
    const out = selectRadarNominees([row('XLF', 'girando')], '2026-07-20', '2026-07-20');
    expect(out).toEqual(RADAR_CONSTITUENTS['XLF']);
    expect(out.length).toBeGreaterThanOrEqual(8);
  });

  it('sectores no-girando no nominan nada', () => {
    const rows = [row('SMH', 'extendido'), row('XLE', 'neutro'), row('GDX', null)];
    expect(selectRadarNominees(rows, '2026-07-20', '2026-07-20')).toEqual([]);
  });

  it('categoría país girando NO nomina (v1 = solo sectores)', () => {
    expect(selectRadarNominees([row('ARGT', 'girando', 'pais')], '2026-07-20', '2026-07-20')).toEqual([]);
  });

  it('snapshot viejo (>7 días) no nomina — fail-closed contra radar caído', () => {
    expect(selectRadarNominees([row('XLF', 'girando')], '2026-07-10', '2026-07-20')).toEqual([]);
  });

  it('snapshotDate null no nomina — fail-closed', () => {
    expect(selectRadarNominees([row('XLF', 'girando')], null, '2026-07-20')).toEqual([]);
  });

  it('dos sectores girando dedupean constituyentes compartidos', () => {
    // FCX está en COPX y XME
    const out = selectRadarNominees([row('COPX', 'girando'), row('XME', 'girando')], '2026-07-20', '2026-07-20');
    expect(out.filter((s) => s === 'FCX').length).toBe(1);
  });

  it('ETF girando sin mapa de constituyentes no rompe (skip silencioso con lista vacía)', () => {
    expect(selectRadarNominees([row('XXXX', 'girando')], '2026-07-20', '2026-07-20')).toEqual([]);
  });
});
