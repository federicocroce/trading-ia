import { describe, it, expect } from 'vitest';
import { extractTickersFromText } from './ticker-extraction.js';

describe('extractTickersFromText', () => {
  const universe = new Set(['ROAD', 'CMCSA', 'LBRDA', 'GIS', 'NVDA', 'TSM', 'EL', 'DK']);

  // --- Casos del brief (relevamiento real) ---

  it('NO extrae ROAD de "Broadband" ni CAST de "Comcast" (substring)', () => {
    const t = extractTickersFromText('Liberty Broadband stock surges 15% on Comcast spinoff news', universe);
    expect(t).not.toContain('ROAD');
  });

  it('extrae tickers como palabra completa en mayúsculas', () => {
    expect(extractTickersFromText('TSM beats estimates; NVDA rallies', universe)).toEqual(
      expect.arrayContaining(['TSM', 'NVDA']),
    );
  });

  it('tickers de 1-2 letras SOLO con prefijo $ o contexto explícito', () => {
    expect(extractTickersFromText('Estée Lauder (EL) cae tras guidance', universe)).toContain('EL');
    expect(extractTickersFromText('EL presidente habló del mercado', universe)).not.toContain('EL');
    expect(extractTickersFromText('$EL breaking out', universe)).toContain('EL');
  });

  it('valida contra el universo: palabra en mayúsculas fuera del universo no es ticker', () => {
    expect(extractTickersFromText('FT reports on AI companies', universe)).toEqual([]);
  });

  // --- Caso real de mercado: market_reports id=98 (evidencia del bug) ---
  // DB real: news_articles con title="Liberty Broadband stock surges 15% on Comcast
  // spinoff news" (RSS:All News) trae related_symbols=["GE","AS","CAST","OMC","AD","ROAD"]
  // -- todos substrings de palabras mixed-case del título, ninguno aparece en MAYÚSCULAS
  // real en el texto original. El universo simula lo que realmente estaba en juego
  // (portfolio + discovery) el día del incidente.
  it('el titular real que produjo ROAD/CAST/OMC/AD/AS/GE en producción no matchea nada de eso', () => {
    const prodUniverse = new Set(['GE', 'AS', 'CAST', 'OMC', 'AD', 'ROAD', 'RS', 'FT', 'ON', 'HON', 'TER', 'DMA', 'EV', 'CMCSA', 'LBRDA']);
    const t = extractTickersFromText(
      'Liberty Broadband stock surges 15% on Comcast spinoff news',
      prodUniverse,
    );
    expect(t).toEqual([]);
  });

  // --- Casos adicionales del mecanismo descubierto ---

  it('respeta la blocklist ampliada aunque el término esté en el universo o tenga contexto explícito', () => {
    const uni = new Set(['AI', 'FT', 'INC', 'CEO', 'USD', 'GDP', 'EPS', 'IPO', 'Q1', 'US', 'UK', 'NYSE']);
    expect(extractTickersFromText('($AI) (FT) (INC) (CEO) (USD) (GDP) (EPS) (IPO) (Q1) (US) (UK) (NYSE)', uni)).toEqual([]);
  });

  it('sin universo (modo discovery) igual aplica word-boundary + contexto 1-2 letras + blocklist', () => {
    // "Broadband"/"Comcast" no deben producir ROAD/CAST ni en modo discovery (sin universo).
    const t = extractTickersFromText('Liberty Broadband stock surges 15% on Comcast spinoff news');
    expect(t).not.toContain('ROAD');
    expect(t).not.toContain('CAST');
    // Palabra 3-5 letras real en mayúsculas SÍ se extrae en modo discovery (sin universo).
    expect(extractTickersFromText('NVDA rallies on earnings beat')).toContain('NVDA');
    // Ticker de 2 letras bare, sin $/() ni universo, se descarta igual (regla c).
    expect(extractTickersFromText('ON the rise again')).not.toContain('ON');
    expect(extractTickersFromText('$ON breaking out')).toContain('ON');
  });

  it('soporta sufijos crypto (-USD/-USDT)', () => {
    const uni = new Set(['BTC-USD', 'ETH-USD']);
    expect(extractTickersFromText('BTC-USD rallies while ETH-USD lags', uni)).toEqual(
      expect.arrayContaining(['BTC-USD', 'ETH-USD']),
    );
  });

  it('texto vacío devuelve []', () => {
    expect(extractTickersFromText('', universe)).toEqual([]);
  });

  it('no duplica un ticker mencionado varias veces', () => {
    expect(extractTickersFromText('NVDA up, NVDA up again, $NVDA to the moon', new Set(['NVDA']))).toEqual(['NVDA']);
  });
});
