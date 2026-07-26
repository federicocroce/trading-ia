import { describe, it, expect } from 'vitest';
import { createTtlCache } from './ttl-cache.js';

describe('createTtlCache', () => {
  it('devuelve el valor dentro del TTL', () => {
    let t = 1000;
    const cache = createTtlCache<number>(500, () => t);
    cache.set('XLB', 42);
    t = 1400; // 400ms después, dentro del TTL
    expect(cache.get('XLB')).toBe(42);
  });

  it('expira pasado el TTL (fail-closed: undefined, no valor viejo)', () => {
    let t = 1000;
    const cache = createTtlCache<number>(500, () => t);
    cache.set('XLB', 42);
    t = 1600; // 600ms después, expirado
    expect(cache.get('XLB')).toBeUndefined();
  });

  it('claves independientes', () => {
    let t = 0;
    const cache = createTtlCache<string>(100, () => t);
    cache.set('A', 'a');
    t = 50;
    cache.set('B', 'b');
    t = 120; // A expiró (120>100), B todavía vive (120-50=70<100)
    expect(cache.get('A')).toBeUndefined();
    expect(cache.get('B')).toBe('b');
  });

  it('sobrescribir resetea el vencimiento', () => {
    let t = 0;
    const cache = createTtlCache<number>(100, () => t);
    cache.set('A', 1);
    t = 80;
    cache.set('A', 2); // refresca
    t = 150; // 70ms desde el refresh, sigue vivo
    expect(cache.get('A')).toBe(2);
  });

  it('clave inexistente → undefined', () => {
    const cache = createTtlCache<number>(100, () => 0);
    expect(cache.get('nope')).toBeUndefined();
  });
});
