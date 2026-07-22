/**
 * Evaluador puro de transiciones de estado de una tesis. Sin I/O: dado el estado persistido de
 * la tesis, el precio vivo del `primarySymbol` y la fecha de hoy, decide si corresponde una
 * transición de estado. El caller (service) es quien persiste el resultado y calcula el outcome
 * numérico — esta función solo decide la transición.
 *
 * Regla crítica fail-closed: si entry e invalidación se tocan en el mismo precio, invalidación
 * gana. En la duda, la tesis muere — nunca se asume gatillada una tesis cuyo nivel de invalidación
 * también fue tocado.
 */

export interface ThesisState {
  status: string;
  direction: string;
  entryTriggerPrice: number;
  entryComparator: string;
  invalidationPrice: number;
  horizonDays: number;
  createdDate: string; // YYYY-MM-DD
  triggeredAt: string | null;
}

export interface ThesisTransition {
  newStatus: 'gatillada' | 'invalidada' | 'expirada' | 'cumplida' | null;
  reason: string | null;
}

const NO_TRANSITION: ThesisTransition = { newStatus: null, reason: null };
const TERMINAL_STATUSES = new Set(['cumplida', 'invalidada', 'expirada']);

/** Invalidación tocada: alcista muere si el precio cae a/bajo el nivel; bajista si sube a/sobre. */
function isInvalidationTouched(direction: string, price: number, invalidationPrice: number): boolean {
  if (direction === 'alcista') return price <= invalidationPrice;
  if (direction === 'bajista') return price >= invalidationPrice;
  return false;
}

/** Entrada tocada según el comparador configurado para el trigger. */
function isEntryTouched(entryComparator: string, price: number, entryTriggerPrice: number): boolean {
  if (entryComparator === 'above') return price >= entryTriggerPrice;
  if (entryComparator === 'below') return price <= entryTriggerPrice;
  return false;
}

/** Suma días (UTC, calendario) a una fecha YYYY-MM-DD y devuelve el resultado en el mismo formato. */
function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Horizonte vencido: hoy es estrictamente posterior a createdDate + horizonDays. */
function isHorizonExpired(createdDate: string, horizonDays: number, today: string): boolean {
  const limit = addDaysUtc(createdDate, horizonDays);
  return today > limit; // comparación lexicográfica de YYYY-MM-DD es válida (formato ISO)
}

export function evaluateThesis(t: ThesisState, price: number | null, today: string): ThesisTransition {
  // Fail-closed: sin precio vivo no hay transición posible.
  if (price === null || !Number.isFinite(price)) return NO_TRANSITION;

  // Estados terminales nunca transicionan.
  if (TERMINAL_STATUSES.has(t.status)) return NO_TRANSITION;

  const horizonExpired = isHorizonExpired(t.createdDate, t.horizonDays, today);

  if (t.status === 'activa') {
    // Invalidación gana si ambas condiciones se tocan a la vez (fail-closed: en la duda, muere).
    if (isInvalidationTouched(t.direction, price, t.invalidationPrice)) {
      return { newStatus: 'invalidada', reason: 'precio tocó el nivel de invalidación' };
    }
    if (isEntryTouched(t.entryComparator, price, t.entryTriggerPrice)) {
      return { newStatus: 'gatillada', reason: 'precio tocó el trigger de entrada' };
    }
    if (horizonExpired) {
      return { newStatus: 'expirada', reason: 'horizonte vencido sin gatillo de entrada' };
    }
    return NO_TRANSITION;
  }

  if (t.status === 'gatillada') {
    if (isInvalidationTouched(t.direction, price, t.invalidationPrice)) {
      return { newStatus: 'invalidada', reason: 'precio tocó el nivel de invalidación luego de gatillar' };
    }
    if (horizonExpired) {
      return { newStatus: 'cumplida', reason: 'sobrevivió el horizonte sin invalidarse' };
    }
    return NO_TRANSITION;
  }

  // Status desconocido/no manejado: fail-closed, no transición.
  return NO_TRANSITION;
}
