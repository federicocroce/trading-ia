import { describe, it, expect } from 'vitest';
import { isActionableTrigger, filterActionableTriggers } from './trigger-validation.js';

describe('isActionableTrigger', () => {
  it('acepta triggers con precio concreto', () => {
    expect(isActionableTrigger('BUY si cierra sobre $64.50 con volumen')).toBe(true);
    expect(isActionableTrigger('Skip si pierde $61')).toBe(true);
  });
  it('acepta referencias a RSI / SMA / soporte / resistencia', () => {
    expect(isActionableTrigger('Entrar si RSI vuelve sobre 40')).toBe(true);
    expect(isActionableTrigger('BUY si recupera la SMA50')).toBe(true);
    expect(isActionableTrigger('Comprar en el soporte')).toBe(true);
  });
  it('rechaza triggers vagos sin nivel', () => {
    expect(isActionableTrigger('Esperar pullback')).toBe(false);
    expect(isActionableTrigger('Ver como abre mañana')).toBe(false);
  });
});

describe('filterActionableTriggers', () => {
  it('filtra los vagos pero conserva al menos el primero si TODOS son vagos (no perder señal)', () => {
    expect(filterActionableTriggers(['Esperar pullback', 'BUY sobre $50'])).toEqual(['BUY sobre $50']);
    expect(filterActionableTriggers(['Esperar pullback'])).toEqual(['Esperar pullback']);
    expect(filterActionableTriggers([])).toEqual([]);
  });
});
