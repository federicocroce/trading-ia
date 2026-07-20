/**
 * Puente radar→universo: cuando un sector del radar de ciclos pasa a "girando",
 * sus constituyentes líquidos entran al universo del scan como NOMINADOS
 * (source='radar'). El radar NO decide acciones — solo nomina candidatos;
 * el embudo normal (anti-hype → scoring → niveles) decide.
 *
 * Lista curada a mano (top holdings líquidos de cada ETF sectorial del radar).
 * Refresh manual esperable ~1 vez/año; registerNovelTickers valida contra Yahoo
 * así que un ticker desactualizado se descarta solo.
 */
export const RADAR_CONSTITUENTS: Record<string, string[]> = {
  XLF: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SCHW', 'C', 'BLK', 'SPGI'],
  SMH: ['NVDA', 'TSM', 'AVGO', 'AMD', 'QCOM', 'MU', 'INTC', 'AMAT', 'ASML', 'LRCX'],
  XBI: ['VRTX', 'REGN', 'GILD', 'AMGN', 'BIIB', 'MRNA', 'ALNY', 'SRPT', 'INCY', 'EXEL'],
  XLE: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB'],
  XLU: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'PEG'],
  ITA: ['GE', 'RTX', 'BA', 'LMT', 'NOC', 'GD', 'HWM', 'LHX', 'TDG', 'AXON'],
  COPX: ['FCX', 'SCCO', 'TECK', 'HBM', 'ERO'],
  URA: ['CCJ', 'NXE', 'UEC', 'DNN', 'LEU', 'UUUU'],
  LIT: ['ALB', 'SQM', 'LAC', 'SGML', 'PLL'],
  GDX: ['NEM', 'GOLD', 'AEM', 'WPM', 'FNV', 'KGC', 'AU', 'RGLD'],
  TAN: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'ARRY', 'SHLS'],
  XME: ['X', 'CLF', 'NUE', 'STLD', 'AA', 'FCX', 'MP', 'ATI'],
};

const MAX_SNAPSHOT_AGE_DAYS = 7;

/** Función pura de decisión: qué símbolos nomina el radar hoy. */
export function selectRadarNominees(
  rows: Array<{ symbol: string; categoria: string; cycleState: string | null }>,
  snapshotDate: string | null,
  today: string,
): string[] {
  // Fail-closed: sin snapshot o snapshot viejo (radar caído) → no nominar nada.
  if (!snapshotDate) return [];
  const ageMs = new Date(today + 'T00:00:00Z').getTime() - new Date(snapshotDate + 'T00:00:00Z').getTime();
  if (ageMs > MAX_SNAPSHOT_AGE_DAYS * 86_400_000 || ageMs < 0) return [];

  const nominees = new Set<string>();
  for (const r of rows) {
    if (r.categoria !== 'sector' || r.cycleState !== 'girando') continue;
    for (const c of RADAR_CONSTITUENTS[r.symbol] ?? []) nominees.add(c);
  }
  return [...nominees];
}
