/**
 * Rotación determinística del universo para el screener diario.
 *
 * El problema: desde el 2026-07-28 el universo operable son ~3.000 símbolos (por liquidez,
 * ya no el S&P 500). Un fetch técnico por símbolo por día no entra en la ventana pre-market.
 *
 * La respuesta que NO se eligió: rankear y quedarse con los mejores. Está medido que el
 * ranking por score no le gana a sortear del mismo universo (prompt maestro §4), así que
 * "los mejores N" es una selección que se cree informada y no lo es.
 *
 * La respuesta elegida: mirar una franja DISTINTA cada día, en orden fijo, hasta cubrir
 * todo el universo y volver a empezar. Sin sesgo de atención, sin ranking, cobertura
 * completa garantizada en ceil(n/size) días, y costo diario constante.
 *
 * Puras: sin I/O.
 */

/** Días desde epoch. Dos corridas el mismo día ven la misma franja (idempotencia diaria). */
export function dayIndexFor(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/**
 * Franja de `size` símbolos que le toca al día `dayIndex`, avanzando en ventana circular.
 * El universo se asume estable y ordenado (lo está: `sweep-universe.json` sale ordenado),
 * así que la cobertura es completa y sin huecos.
 */
export function selectDailySlice(universe: string[], size: number, dayIndex: number): string[] {
  const n = universe.length;
  if (n === 0 || size <= 0) return [];
  if (size >= n) return [...universe];

  const bloques = Math.ceil(n / size);
  const inicio = ((dayIndex % bloques) + bloques) % bloques * size;

  const out: string[] = [];
  for (let i = 0; i < size; i++) out.push(universe[(inicio + i) % n]);
  return out;
}
