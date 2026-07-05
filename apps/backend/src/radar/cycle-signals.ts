// Señales puras del radar de ciclos — sin I/O, testeables sin mocks.
// El radar es capa de CONTEXTO: acá no hay verbos ni decisiones de trading.

export const RADAR_RET_SHORT_SESSIONS = 63;   // ~3 meses
export const RADAR_RET_LONG_SESSIONS = 126;   // ~6 meses
export const RADAR_SMA_SESSIONS = 200;
export const RADAR_EXTENDED_DIST_PCT = 20;    // > 20% sobre la SMA200 = extendido
export const RADAR_TURNING_MAX_SESSIONS = 60; // cruce alcista hace <= 60 sesiones = girando
export const RADAR_HATED_MIN_SESSIONS = 120;  // abajo hace >= 120 sesiones = odiado
export const RADAR_FLOW_LOOKBACK = 20;        // delta de sharesOutstanding a ~20 snapshots

export type CycleState = 'girando' | 'odiado' | 'tendencia' | 'extendido' | 'neutro';

export interface CycleStateInput {
  distSma200Pct: number | null;
  rs3m: number | null;
  rs6m: number | null;
  lado: 'arriba' | 'abajo' | null;
  sesionesEnLado: number | null;
}

// closes en orden ascendente (más viejo primero)
export function computeReturnPct(closes: number[], sessions: number): number | null {
  if (closes.length < sessions + 1) return null;
  const ultimo = closes[closes.length - 1];
  const base = closes[closes.length - 1 - sessions];
  if (!Number.isFinite(ultimo) || !Number.isFinite(base) || base <= 0) return null;
  return ((ultimo - base) / base) * 100;
}

export function computeSma(closes: number[], sessions: number): number | null {
  if (closes.length < sessions) return null;
  const ventana = closes.slice(-sessions);
  return ventana.reduce((a, b) => a + b, 0) / sessions;
}

// De qué lado de su SMA está el cierre y hace cuántas sesiones consecutivas.
// Si nunca cruzó dentro de la ventana calculable, el conteo es cota inferior (ventana completa).
export function computeSmaSide(
  closes: number[],
  smaSessions: number,
): { lado: 'arriba' | 'abajo' | null; sesionesEnLado: number | null } {
  if (closes.length < smaSessions) return { lado: null, sesionesEnLado: null };
  const lados: boolean[] = []; // true = arriba, por cada sesión con SMA calculable
  let suma = closes.slice(0, smaSessions).reduce((a, b) => a + b, 0);
  lados.push(closes[smaSessions - 1] > suma / smaSessions);
  for (let i = smaSessions; i < closes.length; i++) {
    suma += closes[i] - closes[i - smaSessions]; // SMA rodante O(1)
    lados.push(closes[i] > suma / smaSessions);
  }
  const actual = lados[lados.length - 1];
  let sesiones = 1;
  for (let back = lados.length - 2; back >= 0 && lados[back] === actual; back--) sesiones++;
  return { lado: actual ? 'arriba' : 'abajo', sesionesEnLado: sesiones };
}

// Delta % de sharesOutstanding entre el último snapshot y el de hace `lookback`.
// Historia insuficiente o extremos inválidos => null (acumulando / fail-closed).
export function computeFlowDeltaPct(sharesHistory: Array<number | null>, lookback: number): number | null {
  if (sharesHistory.length < lookback + 1) return null;
  const ultimo = sharesHistory[sharesHistory.length - 1];
  const base = sharesHistory[sharesHistory.length - 1 - lookback];
  if (ultimo === null || base === null || !Number.isFinite(ultimo) || !Number.isFinite(base) || base <= 0 || ultimo <= 0) return null;
  return ((ultimo - base) / base) * 100;
}

// Clasificador de fase. Precedencia del spec: extendido > girando > tendencia > odiado > neutro.
export function classifyCycleState(input: CycleStateInput): { state: CycleState | null; reason: string | null } {
  const faltantes = (['distSma200Pct', 'rs3m', 'rs6m', 'lado', 'sesionesEnLado'] as const)
    .filter(k => input[k] === null);
  if (faltantes.length > 0) {
    return { state: null, reason: `datos insuficientes: ${faltantes.join(', ')}` };
  }
  const { distSma200Pct, rs3m, rs6m, lado, sesionesEnLado } = input as {
    distSma200Pct: number; rs3m: number; rs6m: number; lado: 'arriba' | 'abajo'; sesionesEnLado: number;
  };
  if (lado === 'arriba' && distSma200Pct > RADAR_EXTENDED_DIST_PCT) return { state: 'extendido', reason: null };
  if (lado === 'arriba' && sesionesEnLado <= RADAR_TURNING_MAX_SESSIONS && rs3m > 0) return { state: 'girando', reason: null };
  if (lado === 'arriba' && sesionesEnLado > RADAR_TURNING_MAX_SESSIONS && rs3m >= 0) return { state: 'tendencia', reason: null };
  if (lado === 'abajo' && sesionesEnLado >= RADAR_HATED_MIN_SESSIONS && rs6m < 0) return { state: 'odiado', reason: null };
  return { state: 'neutro', reason: null };
}
