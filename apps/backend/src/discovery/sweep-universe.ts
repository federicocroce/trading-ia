/**
 * Universo del barrido de bases: parseo y validación del listado de constituyentes.
 *
 * Por qué existe: hasta el 2026-07-28 `sweep-universe.json` era una lista de 503 símbolos
 * escrita a mano en un solo commit, sin script que la generara ni fecha de captura. Tres
 * problemas: (a) sesgo de supervivencia —es la foto de un índice en un día, o sea empresas
 * que YA habían sobrevivido—, (b) se pudre en silencio (el S&P rota ~20-25 componentes al
 * año y nada avisaba), (c) cualquier backtest futuro sobre ese universo daría mejor que la
 * realidad, que es justo el error de método que este proyecto viene cazando.
 *
 * Esto NO elimina el sesgo de supervivencia —para eso haría falta la composición histórica
 * del índice, que no tenemos— pero elimina la deriva y deja la antigüedad a la vista.
 *
 * Funciones puras: sin red ni FS. El I/O vive en scripts/refresh-sweep-universe.ts.
 */

/** Bandas de plausibilidad: el S&P 500 tiene ~503 tickers (algunas empresas con 2 clases). */
export const MIN_PLAUSIBLE_CONSTITUENTS = 480;
export const MAX_PLAUSIBLE_CONSTITUENTS = 520;

/** Formato aceptable de ticker US: 1-5 alfanuméricos, con guion opcional para clase. */
const TICKER_RE = /^[A-Z]{1,5}(-[A-Z])?$/;

/**
 * Extrae los símbolos de la primera columna de un CSV de constituyentes.
 *
 * Normaliza `.` a `-` (el CSV publica `BRK.B`, Yahoo exige `BRK-B`): sin esto el barrido
 * falla justo en los símbolos con clase de acción. Ordena, dedupea y **descarta lo que no
 * tenga formato de ticker** en vez de propagarlo — fail-closed: un símbolo basura acá se
 * convierte en un fetch fallido por semana, para siempre.
 */
export function parseConstituentsCsv(csv: string): string[] {
  const lines = csv.split('\n').slice(1); // el header no aporta símbolos
  const out = new Set<string>();
  for (const line of lines) {
    const raw = line.split(',')[0]?.trim().replace(/^"|"$/g, '');
    if (!raw) continue;
    const symbol = raw.toUpperCase().replace(/\./g, '-');
    if (!TICKER_RE.test(symbol)) continue;
    out.add(symbol);
  }
  return [...out].sort();
}

/** Forma persistida del universo. El array plano viejo se sigue aceptando al leer. */
export interface SweepUniverseFile {
  capturedAt: string;
  source: string;
  /** Nota honesta sobre lo que este universo NO resuelve. */
  caveat: string;
  symbols: string[];
}

/**
 * Acepta la forma nueva `{capturedAt, symbols}` y la vieja (array plano), para que un
 * archivo sin regenerar siga funcionando. Devuelve null si el contenido no es usable.
 */
export function readUniverse(parsed: unknown): { symbols: string[]; capturedAt: string | null } | null {
  if (Array.isArray(parsed)) {
    const symbols = parsed.filter((s): s is string => typeof s === 'string');
    return symbols.length > 0 ? { symbols, capturedAt: null } : null;
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SweepUniverseFile).symbols)) {
    const f = parsed as SweepUniverseFile;
    const symbols = f.symbols.filter((s) => typeof s === 'string');
    return symbols.length > 0 ? { symbols, capturedAt: f.capturedAt ?? null } : null;
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
