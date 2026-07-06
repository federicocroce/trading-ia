/**
 * Ejecuta `fn` sobre cada item con a lo sumo `limit` tareas en vuelo.
 * Devuelve los resultados en el orden de entrada (no de finalización).
 * Un rechazo de `fn` propaga y aborta el mapeo (mismo contrato que Promise.all).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
