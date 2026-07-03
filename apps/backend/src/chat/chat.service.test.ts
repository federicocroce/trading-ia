import { describe, it, expect } from 'vitest';
import { buildEngineActionsBlock } from './chat.service.js';

describe('buildEngineActionsBlock (contexto del motor para el chat)', () => {
  it('devuelve null cuando no hay scan (aún no corrió el pipeline)', () => {
    expect(buildEngineActionsBlock(undefined, [])).toBeNull();
    expect(buildEngineActionsBlock(null, ['TSM'])).toBeNull();
  });

  it('incluye símbolos con action BUY/SELL y los del portfolio, formateados SYM=ACTION', () => {
    const scan = JSON.stringify([
      { symbol: 'TSM', action: 'BUY' },
      { symbol: 'MARA', action: 'SELL' },
      { symbol: 'AAPL', action: 'WATCH' }, // ni BUY/SELL ni en portfolio → afuera
      { symbol: 'NVDA', action: 'HOLD' }, // en portfolio → entra aunque no sea BUY/SELL
    ]);
    const block = buildEngineActionsBlock(scan, ['NVDA']);
    expect(block).toBe(
      'ACCIONES ACTUALES DEL MOTOR (si las contradecís, decilo explícitamente y explicá por qué): TSM=BUY, MARA=SELL, NVDA=HOLD',
    );
  });

  it('cappea a un máximo de símbolos (parámetro cap)', () => {
    const scan = JSON.stringify(
      Array.from({ length: 25 }, (_, i) => ({ symbol: `SYM${i}`, action: 'BUY' })),
    );
    const block = buildEngineActionsBlock(scan, [], 20);
    const entries = block!.split(': ')[1].split(', ');
    expect(entries).toHaveLength(20);
  });

  it('devuelve null si el scan no tiene ningún símbolo BUY/SELL ni de portfolio', () => {
    const scan = JSON.stringify([{ symbol: 'AAPL', action: 'WATCH' }]);
    expect(buildEngineActionsBlock(scan, [])).toBeNull();
  });

  it('tolera JSON corrupto o inesperado sin tirar', () => {
    expect(buildEngineActionsBlock('not-json', ['TSM'])).toBeNull();
    expect(buildEngineActionsBlock('{"not":"an array"}', ['TSM'])).toBeNull();
  });
});
