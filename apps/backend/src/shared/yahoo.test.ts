import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chunkSymbols, parseV7Quote } from './yahoo.js';

describe('chunkSymbols', () => {
  it('parte una lista en grupos del tamaño pedido', () => {
    expect(chunkSymbols(['A', 'B', 'C', 'D', 'E'], 2)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ]);
  });

  it('lista vacía → sin grupos', () => {
    expect(chunkSymbols([], 50)).toEqual([]);
  });

  it('lista más chica que el chunk → un solo grupo', () => {
    expect(chunkSymbols(['A', 'B'], 50)).toEqual([['A', 'B']]);
  });
});

describe('parseV7Quote', () => {
  const NOW = 1_700_000_000_000;

  it('mapea un item v7 a Price y computa change desde previousClose', () => {
    const price = parseV7Quote(
      {
        symbol: 'XLB',
        regularMarketPrice: 50.5,
        regularMarketPreviousClose: 50.0,
        regularMarketOpen: 50.2,
        regularMarketDayHigh: 51.0,
        regularMarketDayLow: 49.8,
        marketState: 'REGULAR',
      },
      NOW,
    );

    expect(price).toEqual({
      symbol: 'XLB',
      open: 50.2,
      current: 50.5,
      high: 51.0,
      low: 49.8,
      previousClose: 50.0,
      change: 0.5,
      changePercent: 1,
      timestamp: NOW,
      marketState: 'REGULAR',
    });
  });

  it('fail-closed: sin regularMarketPrice devuelve null (no un precio 0 inventado)', () => {
    const price = parseV7Quote(
      { symbol: 'BADX', regularMarketPreviousClose: 10 } as any,
      NOW,
    );
    expect(price).toBeNull();
  });

  it('sin previousClose usa el precio actual y change 0', () => {
    const price = parseV7Quote(
      { symbol: 'NEW', regularMarketPrice: 100 } as any,
      NOW,
    );
    expect(price?.previousClose).toBe(100);
    expect(price?.change).toBe(0);
    expect(price?.changePercent).toBe(0);
  });
});

// --- Orquestación batch + fallback ---
// getQuotes es el único camino por el que entra TODO precio al sistema (ticker,
// cartera, decisiones de "Hoy", tesis). Lo que se protege acá es que el batch
// nunca pierda un símbolo en silencio: lo que el lote no resuelve tiene que
// caer al fan-out per-símbolo, y solo eso.

const quoteV7 = (symbol: string, price: number) => ({
  symbol,
  regularMarketPrice: price,
  regularMarketPreviousClose: price - 1,
  regularMarketOpen: price,
  regularMarketDayHigh: price,
  regularMarketDayLow: price,
  marketState: 'REGULAR',
});

const respV7 = (items: unknown[]) =>
  new Response(JSON.stringify({ quoteResponse: { result: items } }), { status: 200 });

const respChart = (price: number) =>
  new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: { regularMarketPrice: price, previousClose: price - 1 },
            indicators: { quote: [{ open: [price], high: [price], low: [price], close: [price] }] },
          },
        ],
      },
    }),
    { status: 200 },
  );

/** Chart que responde 200 pero sin series — así getQuote falla sin gastar los reintentos. */
const respChartSinData = () =>
  new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });

interface Llamadas {
  crumb: number;
  v7: string[][];
  chart: string[];
}

/**
 * Yahoo de mentira para los cuatro endpoints que toca el módulo (cookie, crumb,
 * v7/quote, v8/chart), registrando qué se pidió. `intento` numera las llamadas a
 * v7 para poder simular un fallo transitorio seguido de éxito.
 */
function montarYahoo(handlers: {
  cookie?: string | null;
  v7?: (symbols: string[], intento: number) => Response;
  chart?: (symbol: string) => Response;
}) {
  const llamadas: Llamadas = { crumb: 0, v7: [], chart: [] };
  let intentoV7 = 0;

  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('https://fc.yahoo.com')) {
      const cookie = handlers.cookie === undefined ? 'A=1' : handlers.cookie;
      return new Response('', {
        status: 200,
        headers: cookie ? { 'set-cookie': `${cookie}; Path=/` } : {},
      });
    }
    if (url.includes('/v1/test/getcrumb')) {
      llamadas.crumb++;
      return new Response('crumb-de-test', { status: 200 });
    }
    if (url.includes('/v7/finance/quote')) {
      const symbols = (new URL(url).searchParams.get('symbols') ?? '').split(',');
      llamadas.v7.push(symbols);
      if (!handlers.v7) throw new Error('el test no esperaba una llamada al batch');
      return handlers.v7(symbols, intentoV7++);
    }
    if (url.includes('/v8/finance/chart/')) {
      const symbol = decodeURIComponent(url.split('/v8/finance/chart/')[1].split('?')[0]);
      llamadas.chart.push(symbol);
      if (!handlers.chart) throw new Error('el test no esperaba caer al fan-out per-símbolo');
      return handlers.chart(symbol);
    }
    throw new Error(`URL inesperada en el test: ${url}`);
  });

  return { fetchMock, llamadas };
}

/** Recarga yahoo.ts con el fetch mockeado (el módulo captura globalThis.fetch al importarse). */
async function cargarYahoo(fetchMock: unknown) {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  return import('./yahoo.js');
}

describe('getQuotes (batch v7 + fallback per-símbolo)', () => {
  beforeEach(() => {
    // El fallback loguea a propósito; silenciarlo mantiene limpia la salida de la suite.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pide al fan-out SOLO los símbolos que el batch no resolvió', async () => {
    const { fetchMock, llamadas } = montarYahoo({
      v7: () => respV7([quoteV7('AAA', 10), quoteV7('BBB', 20)]), // falta CCC
      chart: () => respChart(30),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    const precios = await getQuotes(['AAA', 'BBB', 'CCC']);

    expect(precios.map((p) => p.symbol).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(llamadas.chart).toEqual(['CCC']); // ni AAA ni BBB se vuelven a pedir
  });

  it('si el batch entero no está disponible, cae al fan-out completo sin perder símbolos', async () => {
    const { fetchMock, llamadas } = montarYahoo({
      cookie: null, // sin cookie no hay crumb → getQuotesBatch tira
      chart: () => respChart(42),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    const precios = await getQuotes(['AAA', 'BBB']);

    expect(precios.map((p) => p.symbol).sort()).toEqual(['AAA', 'BBB']);
    expect(llamadas.v7).toEqual([]);
    expect(llamadas.chart.sort()).toEqual(['AAA', 'BBB']);
  });

  it('un item del batch sin precio no se da por resuelto: lo cubre el fan-out', async () => {
    const { fetchMock, llamadas } = montarYahoo({
      v7: () => respV7([quoteV7('AAA', 10), { symbol: 'BBB' }]), // BBB sin regularMarketPrice
      chart: () => respChart(99),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    const precios = await getQuotes(['AAA', 'BBB']);

    expect(llamadas.chart).toEqual(['BBB']);
    expect(precios.find((p) => p.symbol === 'BBB')?.current).toBe(99);
  });

  it('un símbolo que no resuelve por ningún path queda afuera sin voltear la corrida', async () => {
    const { fetchMock } = montarYahoo({
      v7: () => respV7([quoteV7('AAA', 10)]),
      chart: () => respChartSinData(),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    const precios = await getQuotes(['AAA', 'FANTASMA']);

    expect(precios.map((p) => p.symbol)).toEqual(['AAA']);
  });

  it('un 503 transitorio se reintenta dentro del batch, no degrada al fan-out', async () => {
    const { fetchMock, llamadas } = montarYahoo({
      v7: (symbols, intento) =>
        intento === 0
          ? new Response('upstream', { status: 503 })
          : respV7(symbols.map((s) => quoteV7(s, 7))),
      // sin handler de chart: caer al fan-out hace fallar el test
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    // Timers falsos: withRetry espera 800ms reales de backoff y no vale la pena
    // pagarlos en cada corrida de la suite.
    vi.useFakeTimers();
    const pendiente = getQuotes(['AAA', 'BBB']);
    await vi.runAllTimersAsync();
    const precios = await pendiente;
    vi.useRealTimers();

    expect(llamadas.v7).toHaveLength(2);
    expect(llamadas.chart).toEqual([]);
    expect(precios).toHaveLength(2);
  });

  it('el crumb se cachea entre corridas mientras Yahoo no lo rechace', async () => {
    const { fetchMock, llamadas } = montarYahoo({
      v7: (symbols) => respV7(symbols.map((s) => quoteV7(s, 5))),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    await getQuotes(['AAA']);
    await getQuotes(['BBB']);

    expect(llamadas.crumb).toBe(1);
  });

  it('un 401 invalida el crumb: la corrida siguiente lo vuelve a pedir', async () => {
    // Ojo con la semántica real: ensureCrumb() se resuelve UNA vez por corrida, antes
    // de los chunks, así que el reintento inmediato reusa el crumb que Yahoo acaba de
    // rechazar. La invalidación recién surte efecto en la corrida siguiente.
    const { fetchMock, llamadas } = montarYahoo({
      v7: (symbols, intento) =>
        intento === 0
          ? new Response('unauthorized', { status: 401 })
          : respV7(symbols.map((s) => quoteV7(s, 5))),
    });
    const { getQuotes } = await cargarYahoo(fetchMock);

    vi.useFakeTimers();
    const pendiente = getQuotes(['AAA']);
    await vi.runAllTimersAsync();
    await pendiente;
    vi.useRealTimers();
    expect(llamadas.crumb).toBe(1); // el reintento no lo repidió

    await getQuotes(['BBB']);
    expect(llamadas.crumb).toBe(2); // pero quedó invalidado para la próxima
  });
});
