import { describe, it, expect } from 'vitest';
import { isValidTickerFormat } from './ticker-validator.js';

describe('isValidTickerFormat', () => {
  it('acepta tickers reales de 1 letra whitelisteados (T, F, V, X)', () => {
    expect(isValidTickerFormat('T')).toBe(true);
    expect(isValidTickerFormat('F')).toBe(true);
    expect(isValidTickerFormat('V')).toBe(true);
    expect(isValidTickerFormat('X')).toBe(true);
  });

  it('rechaza letras sueltas NO whitelisteadas (sin ticker real asociado)', () => {
    expect(isValidTickerFormat('I')).toBe(false);
    expect(isValidTickerFormat('Q')).toBe(false);
    expect(isValidTickerFormat('Y')).toBe(false);
  });

  it('rechaza dígito suelto', () => {
    expect(isValidTickerFormat('5')).toBe(false);
  });

  it('sigue aceptando tickers normales de 2-10 caracteres', () => {
    expect(isValidTickerFormat('AAPL')).toBe(true);
    expect(isValidTickerFormat('BRK.B')).toBe(true);
    expect(isValidTickerFormat('GG')).toBe(true);
  });

  it('sigue rechazando la blocklist de falsos positivos', () => {
    expect(isValidTickerFormat('AI')).toBe(false);
    expect(isValidTickerFormat('CEO')).toBe(false);
    expect(isValidTickerFormat('USD')).toBe(false);
  });

  it('sigue rechazando formato inválido', () => {
    expect(isValidTickerFormat('')).toBe(false);
    expect(isValidTickerFormat('aapl')).toBe(false);
    expect(isValidTickerFormat('TOOLONGTICKER')).toBe(false);
    expect(isValidTickerFormat('123')).toBe(false);
  });
});
