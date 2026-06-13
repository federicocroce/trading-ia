import { describe, it, expect } from 'vitest';
import { isActionableTrigger, filterActionableTriggers, dropUnrealisticPriceTriggers } from './trigger-validation.js';

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

describe('dropUnrealisticPriceTriggers', () => {
  it('descarta triggers cuyo precio está absurdamente lejos del actual (alucinación)', () => {
    // precio actual $140; "$2" es -98% → irreal
    expect(dropUnrealisticPriceTriggers(['BUY si llega a $2'], 140)).toEqual([]);
    expect(dropUnrealisticPriceTriggers(['BUY si llega a $5000'], 140)).toEqual([]);
  });
  it('conserva triggers con precio plausible', () => {
    expect(dropUnrealisticPriceTriggers(['Vender si cae a $120'], 140)).toEqual(['Vender si cae a $120']);
    expect(dropUnrealisticPriceTriggers(['Comprar sobre $160'], 140)).toEqual(['Comprar sobre $160']);
  });
  it('conserva triggers sin precio (RSI/SMA no se pueden chequear por nivel)', () => {
    expect(dropUnrealisticPriceTriggers(['Entrar si RSI sobre 40'], 140)).toEqual(['Entrar si RSI sobre 40']);
  });
  it('no toca nada si no hay precio actual válido', () => {
    expect(dropUnrealisticPriceTriggers(['BUY si llega a $2'], 0)).toEqual(['BUY si llega a $2']);
  });
});
