import { describe, it, expect } from 'vitest';
import { chunkSymbols, parseV7Quote } from './yahoo.js';

describe('chunkSymbols', () => {
  it('parte una lista en grupos del tamaño pedido', () => {
    expect(chunkSymbols(['A', 'B', 'C', 'D', 'E'], 2)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ]);
  });

  it('lista vacía → sin grupos', () => {
    expect(chunkSymbols([], 50)).toEqual([]);
  });

  it('lista más chica que el chunk → un solo grupo', () => {
    expect(chunkSymbols(['A', 'B'], 50)).toEqual([['A', 'B']]);
  });
});

describe('parseV7Quote', () => {
  const NOW = 1_700_000_000_000;

  it('mapea un item v7 a Price y computa change desde previousClose', () => {
    const price = parseV7Quote(
      {
        symbol: 'XLB',
        regularMarketPrice: 50.5,
        regularMarketPreviousClose: 50.0,
        regularMarketOpen: 50.2,
        regularMarketDayHigh: 51.0,
        regularMarketDayLow: 49.8,
        marketState: 'REGULAR',
      },
      NOW,
    );

    expect(price).toEqual({
      symbol: 'XLB',
      open: 50.2,
      current: 50.5,
      high: 51.0,
      low: 49.8,
      previousClose: 50.0,
      change: 0.5,
      changePercent: 1,
      timestamp: NOW,
      marketState: 'REGULAR',
    });
  });

  it('fail-closed: sin regularMarketPrice devuelve null (no un precio 0 inventado)', () => {
    const price = parseV7Quote(
      { symbol: 'BADX', regularMarketPreviousClose: 10 } as any,
      NOW,
    );
    expect(price).toBeNull();
  });

  it('sin previousClose usa el precio actual y change 0', () => {
    const price = parseV7Quote(
      { symbol: 'NEW', regularMarketPrice: 100 } as any,
      NOW,
    );
    expect(price?.previousClose).toBe(100);
    expect(price?.change).toBe(0);
    expect(price?.changePercent).toBe(0);
  });
});
