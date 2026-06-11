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
