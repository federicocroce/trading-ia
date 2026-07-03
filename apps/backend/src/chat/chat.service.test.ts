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
    const block = buildEngineActionsBlock(scan, ['NVDA'], undefined);
    // NVDA primero: las posiciones del portfolio van SIEMPRE antes que el resto del scan.
    expect(block).toBe(
      'ACCIONES DEL MOTOR (scan del fecha desconocida, si las contradecís, decilo explícitamente y explicá por qué): NVDA=HOLD, TSM=BUY, MARA=SELL',
    );
  });

  it('cappea a un máximo de símbolos (parámetro cap)', () => {
    const scan = JSON.stringify(
      Array.from({ length: 25 }, (_, i) => ({ symbol: `SYM${i}`, action: 'BUY' })),
    );
    const block = buildEngineActionsBlock(scan, [], undefined, 20);
    const entries = block!.split(': ')[1].split(', ');
    expect(entries).toHaveLength(20);
  });

  it('prioriza SIEMPRE las posiciones del portfolio antes del cap', () => {
    // 25 BUY de alto score (el scan viene ordenado por score desc) + 2 posiciones HOLD al final:
    // sin priorización, el cap 20 dejaría afuera a las posiciones — el chat contradiría TUS posiciones.
    const opps = [
      ...Array.from({ length: 25 }, (_, i) => ({ symbol: `SYM${i}`, action: 'BUY' })),
      { symbol: 'NVDA', action: 'HOLD' },
      { symbol: 'TSM', action: 'HOLD' },
    ];
    const block = buildEngineActionsBlock(JSON.stringify(opps), ['NVDA', 'TSM'], undefined, 20)!;
    const entries = block.split(': ')[1].split(', ');
    expect(entries).toHaveLength(20);
    expect(entries).toContain('NVDA=HOLD');
    expect(entries).toContain('TSM=HOLD');
    // Portfolio primero, después el resto por orden del scan
    expect(entries[0]).toBe('NVDA=HOLD');
    expect(entries[1]).toBe('TSM=HOLD');
  });

  it('declara la fecha del scan en el encabezado, formateada en horario de Buenos Aires', () => {
    const scan = JSON.stringify([{ symbol: 'TSM', action: 'BUY' }]);
    // Scan reciente (hace 1 hora): no debe llevar la advertencia de scan viejo.
    const scannedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const block = buildEngineActionsBlock(scan, [], scannedAt)!;
    const expectedFecha = new Date(scannedAt).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    expect(block).toContain(`scan del ${expectedFecha}`);
    expect(block).not.toContain('OJO: scan viejo');
  });

  it('marca el scan como viejo cuando tiene más de 24hs', () => {
    const scan = JSON.stringify([{ symbol: 'TSM', action: 'BUY' }]);
    const scannedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const block = buildEngineActionsBlock(scan, [], scannedAt)!;
    expect(block).toContain('OJO: scan viejo, puede estar desactualizado');
  });

  it('sin scannedAt, declara "fecha desconocida" y no marca el scan como viejo', () => {
    const scan = JSON.stringify([{ symbol: 'TSM', action: 'BUY' }]);
    const block = buildEngineActionsBlock(scan, [], null)!;
    expect(block).toContain('scan del fecha desconocida');
    expect(block).not.toContain('OJO: scan viejo');
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
