import { describe, it, expect } from 'vitest';
import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resuelve normal si la promesa termina antes del límite', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'test');
    expect(result).toBe(42);
  });

  it('rechaza cuando la promesa excede el límite', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, 'gemini')).rejects.toThrow('gemini timed out after 50ms');
  });

  it('propaga el error original si la promesa falla antes del límite', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'test')).rejects.toThrow('boom');
  });
});
