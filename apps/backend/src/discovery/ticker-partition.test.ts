import { describe, it, expect } from 'vitest';
import { partitionTickersForValidation } from './ticker-partition.js';

describe('partitionTickersForValidation', () => {
  const universe = new Set(['AAPL', 'VIST', 'GGAL']);

  it('los tickers del universo se aceptan directo, sin pasar por Yahoo', () => {
    const r = partitionTickersForValidation(['AAPL', 'VIST'], universe, 10);
    expect(r.trusted).toEqual(['AAPL', 'VIST']);
    expect(r.toValidate).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  it('los tickers fuera del universo van a validación', () => {
    const r = partitionTickersForValidation(['AAPL', 'XYZ'], universe, 10);
    expect(r.trusted).toEqual(['AAPL']);
    expect(r.toValidate).toEqual(['XYZ']);
    expect(r.dropped).toEqual([]);
  });

  it('los desconocidos por encima del cap se descartan (fail-closed, no se validan a ciegas)', () => {
    const r = partitionTickersForValidation(['X1', 'X2', 'X3'], universe, 2);
    expect(r.toValidate).toEqual(['X1', 'X2']);
    expect(r.dropped).toEqual(['X3']);
  });

  it('con cap 0 no valida ningún desconocido', () => {
    const r = partitionTickersForValidation(['X1'], universe, 0);
    expect(r.toValidate).toEqual([]);
    expect(r.dropped).toEqual(['X1']);
  });
});
