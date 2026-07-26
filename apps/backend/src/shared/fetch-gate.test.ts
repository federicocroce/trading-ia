import { describe, it, expect } from 'vitest';
import { createFetchGate } from './fetch-gate.js';

describe('createFetchGate', () => {
  it('no excede el máximo de slots concurrentes', async () => {
    const gate = createFetchGate(2);
    await gate.acquire();
    await gate.acquire();

    let third = false;
    void gate.acquire().then(() => { third = true; });
    await Promise.resolve();
    expect(third).toBe(false); // 2 tomados → el 3ro espera

    gate.release();
    await Promise.resolve();
    expect(third).toBe(true); // liberado uno → entra el 3ro
  });

  it('mismo nivel de prioridad → FIFO', async () => {
    const gate = createFetchGate(1);
    await gate.acquire();

    const order: number[] = [];
    const p1 = gate.acquire().then(() => { order.push(1); gate.release(); });
    const p2 = gate.acquire().then(() => { order.push(2); gate.release(); });
    gate.release();

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('los waiters priority saltan la cola por delante de los normales', async () => {
    const gate = createFetchGate(1);
    await gate.acquire();

    const order: string[] = [];
    // Se encola primero el normal, después el priority. Igual el priority entra primero.
    const pN = gate.acquire().then(() => { order.push('normal'); gate.release(); });
    const pP = gate.acquire({ priority: true }).then(() => { order.push('priority'); gate.release(); });
    gate.release();

    await Promise.all([pN, pP]);
    expect(order).toEqual(['priority', 'normal']);
  });
});
