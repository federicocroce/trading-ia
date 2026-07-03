import { describe, it, expect } from 'vitest';
import { filterScreenerCandidates } from './market-screener.js';

const q = (symbol: string, over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(symbol), ...over });
const base = (symbol: string) => ({ symbol, name: symbol, marketCap: 5_000_000_000, price: 50, volume: 10_000_000, changePct: 2 });

describe('filterScreenerCandidates — embudo anti-humo', () => {
  it('rechaza micro-caps y penny (quality bar)', () => {
    const out = filterScreenerCandidates([q('OK'), q('MICRO', { marketCap: 30_000_000 }), q('PENNY', { price: 2.5 })]);
    expect(out.map(c => c.symbol)).toEqual(['OK']);
  });
  it('rechaza lo que ya voló >15% en el día (anti-chase, ambas direcciones)', () => {
    const out = filterScreenerCandidates([q('OK'), q('PUMP', { changePct: 22 }), q('DUMP', { changePct: -18 })]);
    expect(out.map(c => c.symbol)).toEqual(['OK']);
  });
  it('rechaza market cap null (fail-closed)', () => {
    const out = filterScreenerCandidates([q('NOCAP', { marketCap: null as unknown as number })]);
    expect(out).toEqual([]);
  });
  it('rechaza changePct null (fail-closed: sin dato de movimiento no hay anti-chase)', () => {
    const out = filterScreenerCandidates([q('NOMOVE', { changePct: null as unknown as number })]);
    expect(out).toEqual([]);
  });
  it('dedup por símbolo (aparece en gainers Y most_actives)', () => {
    const out = filterScreenerCandidates([q('DUP'), q('DUP')]);
    expect(out).toHaveLength(1);
  });
  it('cap de candidatos (default 40) ordenado por volumen', () => {
    const many = Array.from({ length: 60 }, (_, i) => q(`S${i}`, { volume: 1_000_000 * (i + 1) }));
    const out = filterScreenerCandidates(many);
    expect(out).toHaveLength(40);
    expect(out[0].symbol).toBe('S59'); // mayor volumen primero
  });
});
