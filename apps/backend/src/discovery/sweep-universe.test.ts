import { describe, it, expect } from 'vitest';
import {
  parseScreenerRows,
  readUniverse,
  universeAgeDays,
  MIN_PLAUSIBLE_UNIVERSE,
  MAX_PLAUSIBLE_UNIVERSE,
  type ScreenerRow,
} from './sweep-universe.js';

function row(symbol: string, over: Partial<ScreenerRow> = {}): ScreenerRow {
  return { symbol, name: `${symbol} Common Stock`, lastsale: '$50.00', marketCap: '900000000.00', ...over };
}

describe('parseScreenerRows', () => {
  it('acepta acciones que pasan la quality bar del proyecto ($500M y precio >= $5)', () => {
    expect(parseScreenerRows([row('AAPL'), row('MSFT')])).toEqual(['AAPL', 'MSFT']);
  });

  it('descarta por market cap bajo el piso', () => {
    expect(parseScreenerRows([row('CHICA', { marketCap: '100000000.00' })])).toEqual([]);
  });

  it('descarta por precio bajo $5 (mismo criterio que meetsQualityBar)', () => {
    expect(parseScreenerRows([row('PENNY', { lastsale: '$1.20' })])).toEqual([]);
  });

  it('fail-closed: marketCap o precio ausentes o ilegibles descartan la fila', () => {
    expect(parseScreenerRows([
      row('A1', { marketCap: '' }),
      row('A2', { marketCap: 'N/A' }),
      row('A3', { lastsale: '' }),
      row('A4', { lastsale: 'N/A' }),
    ])).toEqual([]);
  });

  it('excluye instrumentos que no son la acción común: warrants, units, rights, preferidas', () => {
    const raros = [
      row('W1', { name: 'Acme Corp Warrant' }),
      row('U1', { name: 'Acme Corp Unit' }),
      row('R1', { name: 'Acme Corp Rights' }),
      row('P1', { name: 'Acme Corp 7.50% Preferred Series A' }),
    ];
    expect(parseScreenerRows(raros)).toEqual([]);
  });

  it('CONSERVA los ADRs — GGAL/YPF/PAM son la puerta a los CEDEARs que el dueño opera', () => {
    // Regresión del hallazgo 2026-07-28: el universo viejo (S&P500) dejaba afuera 7 de las
    // 8 posiciones de la cartera. Un filtro de "instrumentos raros" que se coma los ADR
    // reintroduce exactamente ese bug.
    const adrs = [
      row('GGAL', { name: 'Grupo Financiero Galicia S.A. American Depositary Shares' }),
      row('YPF', { name: 'YPF Sociedad Anonima American Depositary Shares' }),
    ];
    expect(parseScreenerRows(adrs)).toEqual(['GGAL', 'YPF']);
  });

  it('normaliza separadores de clase a guion — Yahoo exige BRK-B', () => {
    // La fuente publica la clase con BARRA (BRK/B); otras listas usan PUNTO (BRK.B).
    // Yahoo solo entiende el guion. Sin cubrir las dos, Berkshire y compañía se caen del
    // universo en silencio — pasó en la primera corrida real (2026-07-28).
    expect(parseScreenerRows([row('BRK/B'), row('BRK.B')])).toEqual(['BRK-B']);
  });

  it('descarta formatos imposibles', () => {
    expect(parseScreenerRows([row('no es ticker'), row('TOOLONGSYM'), row('')])).toEqual([]);
  });

  it('ordena alfabéticamente y dedupea', () => {
    expect(parseScreenerRows([row('ZTS'), row('AAPL'), row('AAPL')])).toEqual(['AAPL', 'ZTS']);
  });

  it('lista vacía devuelve vacío (el caller decide, fail-closed)', () => {
    expect(parseScreenerRows([])).toEqual([]);
  });

  it('las bandas de plausibilidad encierran el tamaño esperado del universo', () => {
    expect(MIN_PLAUSIBLE_UNIVERSE).toBeLessThan(2912);
    expect(MAX_PLAUSIBLE_UNIVERSE).toBeGreaterThan(2912);
  });
});

describe('readUniverse', () => {
  it('lee el formato nuevo {capturedAt, symbols}', () => {
    const r = readUniverse({ capturedAt: '2026-07-28', source: 'x', caveat: 'y', symbols: ['AAPL'] });
    expect(r).toEqual({ symbols: ['AAPL'], capturedAt: '2026-07-28' });
  });

  it('sigue aceptando el array plano viejo (un archivo sin regenerar no rompe nada)', () => {
    expect(readUniverse(['AAPL', 'MSFT'])).toEqual({ symbols: ['AAPL', 'MSFT'], capturedAt: null });
  });

  it('devuelve null ante contenido inservible', () => {
    expect(readUniverse(null)).toBeNull();
    expect(readUniverse([])).toBeNull();
    expect(readUniverse({ symbols: [] })).toBeNull();
    expect(readUniverse('no soy un universo')).toBeNull();
  });
});

describe('universeAgeDays', () => {
  it('cuenta los días desde la captura', () => {
    expect(universeAgeDays('2026-07-01', new Date('2026-07-28T12:00:00Z'))).toBe(27);
  });
  it('sin fecha o fecha ilegible devuelve null (no se inventa antigüedad)', () => {
    expect(universeAgeDays(null, new Date())).toBeNull();
    expect(universeAgeDays('no-es-fecha', new Date())).toBeNull();
  });
});
