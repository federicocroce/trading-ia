/**
 * Un trigger accionable referencia un nivel concreto: precio ($X), RSI, SMA/media,
 * soporte/resistencia, breakout o porcentaje. "Esperar pullback" no permite setear nada.
 */
const LEVEL_PATTERN = /\$\s?\d+(\.\d+)?|\bRSI\b|\bSMA\s?\d*\b|\bmedia de \d+\b|soporte|resistencia|breakout|ruptura|\d+(\.\d+)?\s?%/i;

export function isActionableTrigger(trigger: string): boolean {
  return LEVEL_PATTERN.test(trigger);
}

/** Si todos son vagos, conserva el primero — mejor señal débil que campo vacío. */
export function filterActionableTriggers(triggers: string[]): string[] {
  if (triggers.length === 0) return triggers;
  const actionable = triggers.filter(isActionableTrigger);
  return actionable.length > 0 ? actionable : [triggers[0]];
}

/**
 * Anclaje anti-alucinación: descarta triggers cuyo precio en $ está absurdamente lejos del
 * actual (ej. "$2" cuando cotiza $140). Triggers sin precio (RSI/SMA) se conservan.
 */
export function dropUnrealisticPriceTriggers(triggers: string[], currentPrice: number, maxDevPct = 60): string[] {
  if (!currentPrice || currentPrice <= 0) return triggers;
  const lo = currentPrice * (1 - maxDevPct / 100);
  const hi = currentPrice * (1 + maxDevPct / 100);
  return triggers.filter((t) => {
    const prices = [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    if (prices.length === 0) return true; // sin precio: no se puede chequear por nivel
    return prices.every((p) => p >= lo && p <= hi);
  });
}
