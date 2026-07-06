import type { NewsItem } from '@trading/shared';

/**
 * Decide si una noticia necesita pasar por el LLM.
 *
 * El flag `analyzedAt` es la fuente de verdad: si está seteado, la noticia ya fue
 * analizada aunque el resultado haya sido neutral/low (antes ese caso era
 * indistinguible del "sin analizar" y se re-trabajaba en cada corrida).
 *
 * Fallback legacy para filas anteriores al flag: un sentiment no-neutral o un
 * impact no-low solo pueden venir de un análisis previo.
 */
export function needsLlmAnalysis(item: NewsItem): boolean {
  if (item.analyzedAt) return false;
  return item.sentiment === 'neutral' && item.impact === 'low';
}
