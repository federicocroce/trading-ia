import { describe, it, expect } from 'vitest';
import { parseConstituentsCsv, MIN_PLAUSIBLE_CONSTITUENTS, MAX_PLAUSIBLE_CONSTITUENTS } from './sweep-universe.js';

const HEADER = 'Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded';

describe('parseConstituentsCsv', () => {
  it('extrae los símbolos de la primera columna, salteando el header', () => {
    const csv = [HEADER, 'MMM,3M,Industrials,X,"Saint Paul, Minnesota",1957-03-04,66740,1902', 'AAPL,Apple,Tech,Y,"Cupertino, CA",1982-11-30,320193,1977'].join('\n');
    expect(parseConstituentsCsv(csv)).toEqual(['AAPL', 'MMM']);
  });

  it('normaliza el punto a guion — Yahoo usa BRK-B, no BRK.B', () => {
    // Sin esto el barrido falla justo en los símbolos con clase de acción.
    const csv = [HEADER, 'BRK.B,Berkshire,Financials,X,"Omaha, NE",2010-02-16,1067983,1839', 'BF.B,Brown-Forman,Staples,Y,"Louisville, KY",1982-10-31,14693,1870'].join('\n');
    expect(parseConstituentsCsv(csv)).toEqual(['BF-B', 'BRK-B']);
  });

  it('devuelve orden alfabético estable y sin duplicados', () => {
    const csv = [HEADER, 'ZTS,Z,S,I,"L",d,1,2', 'AAPL,A,S,I,"L",d,1,2', 'AAPL,A,S,I,"L",d,1,2', 'MMM,M,S,I,"L",d,1,2'].join('\n');
    expect(parseConstituentsCsv(csv)).toEqual(['AAPL', 'MMM', 'ZTS']);
  });

  it('ignora líneas vacías y con símbolo en blanco', () => {
    const csv = [HEADER, 'AAPL,A,S,I,"L",d,1,2', '', '   ', ',Sin simbolo,S,I,"L",d,1,2'].join('\n');
    expect(parseConstituentsCsv(csv)).toEqual(['AAPL']);
  });

  it('descarta símbolos con formato imposible en vez de propagarlos', () => {
    const csv = [HEADER, 'AAPL,A,S,I,"L",d,1,2', 'no es un ticker,X,S,I,"L",d,1,2', 'TOOLONGSYM,X,S,I,"L",d,1,2'].join('\n');
    expect(parseConstituentsCsv(csv)).toEqual(['AAPL']);
  });

  it('CSV vacío o solo header devuelve lista vacía (el caller decide, fail-closed)', () => {
    expect(parseConstituentsCsv('')).toEqual([]);
    expect(parseConstituentsCsv(HEADER)).toEqual([]);
  });

  it('las bandas de plausibilidad encierran el tamaño real del S&P 500', () => {
    expect(MIN_PLAUSIBLE_CONSTITUENTS).toBeLessThan(503);
    expect(MAX_PLAUSIBLE_CONSTITUENTS).toBeGreaterThan(503);
  });
});
