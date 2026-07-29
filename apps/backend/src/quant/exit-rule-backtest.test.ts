import { describe, it, expect } from 'vitest';
import { shouldExit, strategyMetrics, buyHoldMetrics } from './exit-rule-backtest.js';

describe('shouldExit (aísla el desacuerdo: ¿salir ante una divergencia bajista?)', () => {
  it('AMBAS reglas salen si el precio toca el trailing stop', () => {
    const s = { price: 95, trailingStop: 96, hasBearishDiv: false };
    expect(shouldExit('sell_on_warning', s)).toBe(true);
    expect(shouldExit('let_it_run', s)).toBe(true);
  });

  it('con divergencia bajista pero precio arriba del stop: A vende, B aguanta', () => {
    const s = { price: 110, trailingStop: 100, hasBearishDiv: true };
    expect(shouldExit('sell_on_warning', s)).toBe(true);  // el motor: vende la advertencia
    expect(shouldExit('let_it_run', s)).toBe(false);      // Hoy: la deja correr
  });

  it('sin divergencia y arriba del stop: ninguna sale', () => {
    const s = { price: 110, trailingStop: 100, hasBearishDiv: false };
    expect(shouldExit('sell_on_warning', s)).toBe(false);
    expect(shouldExit('let_it_run', s)).toBe(false);
  });
});

describe('strategyMetrics', () => {
  it('retorno total, win-rate y profit factor', () => {
    const equity = [100, 110, 105, 120];
    const trades = [10, -5, 15]; // % por trade
    const m = strategyMetrics(equity, trades);
    expect(m.totalReturn).toBe(20);          // 120 - 100
    expect(m.numTrades).toBe(3);
    expect(m.winRate).toBe(67);              // 2 de 3
    expect(m.profitFactor).toBeCloseTo(5);   // (10+15)/5
  });

  it('max drawdown sobre la curva de equity', () => {
    const m = strategyMetrics([100, 120, 90, 110], [20, -25, 22]);
    expect(m.maxDrawdown).toBe(25);          // 120 → 90 = -25%
  });

  it('sin trades → ceros', () => {
    expect(strategyMetrics([100], []).numTrades).toBe(0);
  });
});

// AD-014 (auditoría 2026-07-29): el estudio comparaba la regla A contra la B y NUNCA contra
// comprar y no hacer nada — la única alternativa real. Sin esta columna el "gana 9 de 11" no
// puede sostener el claim del objetivo #1.
describe('buyHoldMetrics (la columna que faltaba: comprar y no hacer nada)', () => {
  it('retorno y drawdown de la serie completa', () => {
    // 100 → 120 (pico) → 90 (dd 25%) → 110  ⇒ retorno +10%, maxDd 25%
    const m = buyHoldMetrics([100, 120, 90, 110]);
    expect(m).not.toBeNull();
    expect(m!.totalReturn).toBe(10);
    expect(m!.maxDrawdown).toBe(25);
  });

  it('serie monótona creciente: drawdown cero', () => {
    const m = buyHoldMetrics([100, 105, 110]);
    expect(m!.totalReturn).toBe(10);
    expect(m!.maxDrawdown).toBe(0);
  });

  it('FAIL-CLOSED: menos de dos cierres no alcanza para un retorno → null', () => {
    expect(buyHoldMetrics([100])).toBeNull();
    expect(buyHoldMetrics([])).toBeNull();
  });

  it('FAIL-CLOSED: un cierre no positivo o no finito invalida la serie → null (jamás imputar)', () => {
    expect(buyHoldMetrics([100, 0, 110])).toBeNull();
    expect(buyHoldMetrics([100, NaN, 110])).toBeNull();
    expect(buyHoldMetrics([100, -5])).toBeNull();
  });
});
