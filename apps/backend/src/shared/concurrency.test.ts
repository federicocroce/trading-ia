import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('devuelve los resultados en el orden de los items de entrada', async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(results).toEqual([60, 20, 40]);
  });

  it('nunca ejecuta más tareas simultáneas que el límite', async () => {
    let running = 0;
    let maxRunning = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });
    expect(maxRunning).toBe(2);
  });

  it('funciona con límite mayor que la cantidad de items', async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });

  it('pasa el índice del item a la función', async () => {
    const results = await mapWithConcurrency(['a', 'b'], 1, async (item, idx) => `${item}${idx}`);
    expect(results).toEqual(['a0', 'b1']);
  });

  it('con lista vacía devuelve lista vacía sin invocar la función', async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 3, async () => { calls++; });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});
