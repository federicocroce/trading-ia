/**
 * Validador puro fail-closed de tesis generadas por el LLM. Sin I/O: recibe el objeto crudo que
 * devolvió el LLM (tipado `unknown`, nunca confiar en su shape) y los precios vivos ya resueltos
 * por el caller, y decide si la tesis es operable o si se rechaza con un motivo concreto.
 *
 * El LLM alucina: symbols inventados, niveles a 3x el precio, narrativas vacías. Cada regla acá
 * existe porque una tesis mal formada que se persiste como si fuera válida contamina el tracking
 * de todo el motor (signal_tracking-style). Ante la duda, rechazo — nunca "neutral" ni pass silencioso.
 */

/** Shape que se le pide al LLM. Todo opcional/unknown: no confiamos en el tipado del proveedor. */
export interface RawThesis {
  title?: unknown;
  direction?: unknown;
  narrative?: unknown;
  catalyst?: unknown;
  primarySymbol?: unknown;
  symbols?: unknown;
  entryConditionText?: unknown;
  entryTriggerPrice?: unknown;
  entryComparator?: unknown;
  invalidationPrice?: unknown;
  invalidationReason?: unknown;
  horizonDays?: unknown;
}

export interface ValidThesis {
  title: string;
  direction: 'alcista' | 'bajista';
  narrative: string;
  catalyst: string | null;
  primarySymbol: string;
  symbols: string[];
  entryConditionText: string;
  entryTriggerPrice: number;
  entryComparator: 'above' | 'below';
  invalidationPrice: number;
  invalidationReason: string;
  horizonDays: number;
}

export type ValidateThesisResult = { ok: true; thesis: ValidThesis } | { ok: false; reason: string };

const REQUIRED_STRING_FIELDS = [
  'title', 'direction', 'narrative', 'primarySymbol',
  'entryConditionText', 'entryComparator', 'invalidationReason',
] as const;

const REQUIRED_NUMBER_FIELDS = ['entryTriggerPrice', 'invalidationPrice', 'horizonDays'] as const;

const MAX_TITLE_LENGTH = 120;
const MIN_NARRATIVE_LENGTH = 100;
const MAX_SYMBOLS = 5;
const MIN_HORIZON_DAYS = 5;
const MAX_HORIZON_DAYS = 120;
const TRIGGER_TOLERANCE_PCT = 0.25;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export function validateThesis(raw: unknown, livePrices: Map<string, number>): ValidateThesisResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('la tesis cruda no es un objeto válido');
  }
  const r = raw as RawThesis;

  // --- Grupo 1: campos obligatorios presentes y tipados ---
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = r[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return fail(`campo requerido faltante o inválido: ${field}`);
    }
  }
  if (!Array.isArray(r.symbols) || r.symbols.length === 0) {
    return fail('campo requerido faltante o inválido: symbols');
  }
  if (!r.symbols.every((s) => typeof s === 'string' && s.trim().length > 0)) {
    return fail('campo requerido faltante o inválido: symbols (cada elemento debe ser string no vacío)');
  }
  for (const field of REQUIRED_NUMBER_FIELDS) {
    const value = r[field];
    if (typeof value !== 'number') {
      return fail(`campo requerido faltante o inválido: ${field}`);
    }
  }
  // catalyst es opcional/nullable, pero si viene debe ser string o null
  if (r.catalyst !== undefined && r.catalyst !== null && typeof r.catalyst !== 'string') {
    return fail('campo inválido: catalyst debe ser string o null');
  }

  // --- Grupo 5: números no finitos/negativos → rechazo (antes de comparar niveles) ---
  const entryTriggerPrice = r.entryTriggerPrice as number;
  const invalidationPrice = r.invalidationPrice as number;
  const horizonDaysRaw = r.horizonDays as number;
  for (const [name, value] of [
    ['entryTriggerPrice', entryTriggerPrice],
    ['invalidationPrice', invalidationPrice],
    ['horizonDays', horizonDaysRaw],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      return fail(`número inválido (no finito o negativo): ${name}`);
    }
  }

  // --- Grupo 2: enums y horizonDays ---
  const direction = r.direction as string;
  if (direction !== 'alcista' && direction !== 'bajista') {
    return fail('direction inválida: debe ser "alcista" o "bajista"');
  }
  const entryComparator = r.entryComparator as string;
  if (entryComparator !== 'above' && entryComparator !== 'below') {
    return fail('entryComparator inválido: debe ser "above" o "below"');
  }
  if (!Number.isInteger(horizonDaysRaw) || horizonDaysRaw < MIN_HORIZON_DAYS || horizonDaysRaw > MAX_HORIZON_DAYS) {
    return fail(`horizonDays inválido: debe ser un entero entre ${MIN_HORIZON_DAYS} y ${MAX_HORIZON_DAYS}`);
  }

  // --- Grupo 4: symbols/longitudes ---
  const title = r.title as string;
  const narrative = r.narrative as string;
  const primarySymbol = r.primarySymbol as string;
  const symbols = r.symbols as string[];

  if (!symbols.includes(primarySymbol)) {
    return fail('primarySymbol debe estar incluido en symbols');
  }
  if (symbols.length > MAX_SYMBOLS) {
    return fail(`symbols no puede tener más de ${MAX_SYMBOLS} elementos`);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return fail(`title excede ${MAX_TITLE_LENGTH} caracteres`);
  }
  if (narrative.length < MIN_NARRATIVE_LENGTH) {
    return fail(`narrative debe tener al menos ${MIN_NARRATIVE_LENGTH} caracteres (una tesis sin "por qué" sustancial no es tesis)`);
  }

  // --- Grupo 3: coherencia de niveles vs precio vivo ---
  const livePrice = livePrices.get(primarySymbol);
  if (livePrice === undefined || !Number.isFinite(livePrice)) {
    return fail(`sin precio vivo para primarySymbol (${primarySymbol}): no se puede validar coherencia de niveles`);
  }

  const triggerLowerBound = livePrice * (1 - TRIGGER_TOLERANCE_PCT);
  const triggerUpperBound = livePrice * (1 + TRIGGER_TOLERANCE_PCT);
  if (entryTriggerPrice < triggerLowerBound || entryTriggerPrice > triggerUpperBound) {
    return fail(
      `entryTriggerPrice fuera de rango razonable respecto al precio vivo (±${TRIGGER_TOLERANCE_PCT * 100}%): ` +
      `trigger=${entryTriggerPrice}, precio vivo=${livePrice}`,
    );
  }

  if (direction === 'alcista' && invalidationPrice >= livePrice) {
    return fail('nivel de invalidación (invalidationPrice) debe ser menor al precio vivo en una tesis alcista');
  }
  if (direction === 'bajista' && invalidationPrice <= livePrice) {
    return fail('nivel de invalidación (invalidationPrice) debe ser mayor al precio vivo en una tesis bajista');
  }

  const catalyst: string | null = typeof r.catalyst === 'string' ? r.catalyst : null;

  return {
    ok: true,
    thesis: {
      title,
      direction,
      narrative,
      catalyst,
      primarySymbol,
      symbols,
      entryConditionText: r.entryConditionText as string,
      entryTriggerPrice,
      entryComparator,
      invalidationPrice,
      invalidationReason: r.invalidationReason as string,
      horizonDays: horizonDaysRaw,
    },
  };
}
