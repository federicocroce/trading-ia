/**
 * Separa los tickers que devuelve el LLM en tres grupos antes del anclaje anti-alucinación:
 * - trusted: ya están en el universo conocido → válidos por definición, sin llamada a Yahoo
 * - toValidate: desconocidos dentro del cap → se validan contra Yahoo
 * - dropped: desconocidos por encima del cap → se descartan (fail-closed) y se loguean
 *
 * Razón: el LLM recibe el universo en el prompt, así que la mayoría de sus tickers ya son
 * conocidos. Validar TODO contra Yahoo (cientos de tickers, muchos inventados, con retries
 * sobre un API rate-limiteado) tenía la etapa de noticias horas moliendo.
 */
export function partitionTickersForValidation(
  tickers: readonly string[],
  universe: ReadonlySet<string>,
  maxUnknownValidations: number,
): { trusted: string[]; toValidate: string[]; dropped: string[] } {
  const trusted: string[] = [];
  const unknown: string[] = [];
  for (const t of tickers) {
    (universe.has(t) ? trusted : unknown).push(t);
  }
  return {
    trusted,
    toValidate: unknown.slice(0, maxUnknownValidations),
    dropped: unknown.slice(maxUnknownValidations),
  };
}
