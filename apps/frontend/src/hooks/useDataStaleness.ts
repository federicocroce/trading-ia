export type StalenessLevel = 'fresh' | 'warning' | 'stale';

export interface StalenessInfo {
  level: StalenessLevel;
  label: string; // e.g. "hace 2h", "ahora"
  ageMs: number;
}

const THRESHOLDS = {
  warning: 60 * 60 * 1000,     // 1 hora
  stale:   6 * 60 * 60 * 1000, // 6 horas
};

export function getStaleness(timestamp: number | null | undefined): StalenessInfo {
  if (!timestamp) {
    return { level: 'stale', label: 'sin datos', ageMs: Infinity };
  }

  const ageMs = Date.now() - timestamp;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHrs = Math.floor(ageMin / 60);
  const ageDays = Math.floor(ageHrs / 24);

  let label: string;
  if (ageMin < 1) label = 'ahora';
  else if (ageMin < 60) label = `hace ${ageMin}m`;
  else if (ageHrs < 24) label = `hace ${ageHrs}h`;
  else label = `hace ${ageDays}d`;

  let level: StalenessLevel;
  if (ageMs < THRESHOLDS.warning) level = 'fresh';
  else if (ageMs < THRESHOLDS.stale) level = 'warning';
  else level = 'stale';

  return { level, label, ageMs };
}

export function useDataStaleness(timestamp: number | null | undefined): StalenessInfo {
  return getStaleness(timestamp);
}
