/**
 * Universo del barrido de bases: parseo y validación.
 *
 * ⚠️ CAMBIO DE FUENTE 2026-07-28 — de índice a LIQUIDEZ.
 *
 * Antes el universo era el S&P 500 (503 símbolos, lista escrita a mano). Dos problemas, y
 * el segundo era grave:
 *   1. Sesgo de supervivencia: pertenecer al índice ya es haber sobrevivido.
 *   2. **Era el universo equivocado.** El detector busca "acción castigada que empieza a
 *      repararse" — un patrón de mid/small cap— y se lo apuntaba a las large caps más
 *      establecidas del mercado. Verificado: IREN, el caso que MOTIVÓ construir el barrido,
 *      no estaba en el universo del barrido. Tampoco WULF, HUT, MARA, RIOT, CLSK, VIST ni
 *      SOFI. **7 de las 8 posiciones de la cartera del dueño quedaban afuera.**
 *
 * Ahora el universo se define por LIQUIDEZ Y TAMAÑO, no por pertenecer a un club: todo lo
 * listado en US que pase la misma quality bar que el resto del sistema exige
 * (marketCap ≥ $500M y precio ≥ $5, ver `meetsQualityBar`). Incluir menos que eso sería
 * gastar fetches en símbolos que el embudo rechaza igual aguas abajo.
 *
 * Esto SÍ elimina el sesgo de supervivencia por pertenencia al índice. Lo que queda es el
 * sesgo de "listado hoy" (las deslistadas no aparecen), inevitable sin datos históricos.
 *
 * Funciones puras: sin red ni FS. El I/O vive en scripts/refresh-sweep-universe.ts.
 */

/**
 * Bandas de plausibilidad del universo resultante. Con los umbrales actuales da ~2.900;
 * si una corrida cae fuera de esta banda, la fuente cambió de formato y NO se escribe nada.
 */
export const MIN_PLAUSIBLE_UNIVERSE = 1_500;
export const MAX_PLAUSIBLE_UNIVERSE = 5_000;

/** Mismos umbrales que `meetsQualityBar` para acciones — coherencia con el resto del embudo. */
const MIN_MARKET_CAP = 500_000_000;
const MIN_PRICE = 5;

/** Formato aceptable de ticker US: 1-5 alfanuméricos, con guion opcional para clase. */
const TICKER_RE = /^[A-Z]{1,5}(-[A-Z])?$/;

/**
 * Separadores de clase de acción según la fuente: el screener de Nasdaq publica `BRK/B`,
 * otras listas publican `BRK.B`, y Yahoo solo entiende `BRK-B`. Cubrir uno solo hace que
 * las duales se caigan del universo sin ruido — pasó en la primera corrida real.
 */
const SEPARADOR_DE_CLASE = /[./]/g;

/**
 * Instrumentos que NO son la acción común y solo gastan fetches.
 * ⚠️ Ojo con tocar esta regex: los ADR (`American Depositary Shares`) SÍ se conservan — son
 * la puerta a los CEDEARs que el dueño opera (GGAL, YPF, PAM, VIST). Un filtro que se los
 * coma reintroduce el bug que este archivo existe para arreglar. La alternancia de
 * "preferred" pide un % adelante justamente para no atrapar "Depositary Shares" comunes.
 */
const NO_ES_ACCION_COMUN = /\b(warrant|unit|right)s?\b|\d+(\.\d+)?%\s*(preferred|notes|debenture)|\bpreferred\s+(stock|series)\b/i;

/** Fila cruda del screener: solo los campos que este módulo mira. */
export interface ScreenerRow {
  symbol: string;
  name: string;
  lastsale: string;   // "$141.34"
  marketCap: string;  // "39920314881.00"
}

/** "$1,234.50" → 1234.5. Devuelve NaN si no hay número (fail-closed en el caller). */
function money(raw: string | null | undefined): number {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned.toUpperCase() === 'N/A') return Number.NaN;
  return Number(cleaned);
}

/**
 * Filtra el listado crudo al universo operable y devuelve los símbolos ordenados.
 *
 * Fail-closed en cada campo: market cap o precio ausentes/ilegibles descartan la fila —
 * un dato faltante nunca pasa como si estuviera bien. Normaliza `.` a `-` (Yahoo exige
 * `BRK-B`, no `BRK.B`) y descarta lo que no tenga forma de ticker: un símbolo basura acá
 * se convierte en un fetch fallido por semana, para siempre.
 */
export function parseScreenerRows(rows: ScreenerRow[]): string[] {
  return Object.keys(parseScreenerRowsWithCaps(rows)).sort();
}

/**
 * Igual que `parseScreenerRows` pero devuelve el market cap de captura por símbolo.
 * El screener diario lo necesita: trabaja con quotes en lote (v7), que NO traen marketCap,
 * y `meetsQualityBar` es fail-closed ante un cap nulo — pasarle null filtraría todo. Guardar
 * el cap medido al generar el universo permite que el chequeo siga corriendo de verdad en
 * vez de saltearlo en silencio, que es justo lo que las reglas duras prohíben.
 */
export function parseScreenerRowsWithCaps(rows: ScreenerRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (NO_ES_ACCION_COMUN.test(r?.name ?? '')) continue;

    const cap = money(r?.marketCap);
    const price = money(r?.lastsale);
    if (!Number.isFinite(cap) || cap < MIN_MARKET_CAP) continue;
    if (!Number.isFinite(price) || price < MIN_PRICE) continue;

    const symbol = String(r?.symbol ?? '').trim().toUpperCase().replace(SEPARADOR_DE_CLASE, '-');
    if (!TICKER_RE.test(symbol)) continue;
    out[symbol] = cap;
  }
  return out;
}

/** Forma persistida del universo. El array plano viejo se sigue aceptando al leer. */
export interface SweepUniverseFile {
  capturedAt: string;
  source: string;
  /** Nota honesta sobre lo que este universo NO resuelve. */
  caveat: string;
  symbols: string[];
  /** Market cap al momento de la captura, por símbolo. Ver parseScreenerRowsWithCaps. */
  marketCaps?: Record<string, number>;
}

/**
 * Acepta la forma nueva `{capturedAt, symbols}` y la vieja (array plano), para que un
 * archivo sin regenerar siga funcionando. Devuelve null si el contenido no es usable.
 */
export function readUniverse(
  parsed: unknown,
): { symbols: string[]; capturedAt: string | null; marketCaps: Record<string, number> } | null {
  if (Array.isArray(parsed)) {
    const symbols = parsed.filter((s): s is string => typeof s === 'string');
    return symbols.length > 0 ? { symbols, capturedAt: null, marketCaps: {} } : null;
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SweepUniverseFile).symbols)) {
    const f = parsed as SweepUniverseFile;
    const symbols = f.symbols.filter((s) => typeof s === 'string');
    return symbols.length > 0
      ? { symbols, capturedAt: f.capturedAt ?? null, marketCaps: f.marketCaps ?? {} }
      : null;
  }
  return null;
}

/** Días desde la captura. null si el archivo no la declara (formato viejo). */
export function universeAgeDays(capturedAt: string | null, now: Date): number | null {
  if (!capturedAt) return null;
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}
