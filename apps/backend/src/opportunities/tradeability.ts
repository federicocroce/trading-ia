/**
 * ¿Este instrumento sirve para swing trading de ganancia? Filtra el ruido que el descubrimiento
 * por noticias mete en el universo: bonos, MLPs, preferidas, fondos de renta, y micro-caps
 * intransitables. NO son vehículos de momentum — no dan "la mayor ganancia" que buscamos.
 *
 * Puro y testeable. La parte de I/O (volumen) la calcula el scan y la pasa acá.
 */

// Nombres que delatan renta fija / MLP / preferida / fondo de renta (no swing).
const EXCLUDE_NAME = /\b(bonds?|treasur\w*|high[\s-]?yield|municipal|aggregate bond|income fund|preferred|depositary|master limited|\bl\.?p\.?\b|\bmlp\b|partners l\.?p)\b/i;

const MIN_DOLLAR_VOLUME = 1_000_000; // < ~$1M/día = intransitable para entrar/salir sin mover el precio

export function isExcludedInstrument(name: string | undefined | null, instrumentType: string | undefined | null): boolean {
  if (instrumentType === 'bono') return true;
  if (name && EXCLUDE_NAME.test(name)) return true;
  return false;
}

export function isLiquidEnough(avgDollarVolume: number | null | undefined, min = MIN_DOLLAR_VOLUME): boolean {
  return avgDollarVolume != null && avgDollarVolume >= min;
}

export function isTradeable(meta: { name?: string | null; instrumentType?: string | null; avgDollarVolume?: number | null }): boolean {
  return !isExcludedInstrument(meta.name, meta.instrumentType) && isLiquidEnough(meta.avgDollarVolume);
}

// Barrera de calidad: bajo estos umbrales el riesgo de pump-and-dump / iliquidez
// real supera cualquier edge del análisis. Dato faltante = NO pasa (fail-closed):
// si no sabemos cuánto vale la empresa, no la recomendamos.
function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const MIN_MARKET_CAP = envNumber('MIN_MARKET_CAP_USD', 500_000_000);
const MIN_QUALITY_PRICE = envNumber('MIN_QUALITY_PRICE_USD', 5);

export function meetsQualityBar(meta: {
  marketCap?: number | null;
  currentPrice?: number | null;
  instrumentType?: string | null;
}): boolean {
  // Cripto: market cap y precio tienen otra semántica; el riesgo se gestiona aparte.
  if (meta.instrumentType === 'crypto') return true;
  // ETFs y commodity-ETFs (GLD/SLV/USO...): Yahoo no reporta marketCap de fondos —
  // exigir solo precio (la liquidez ya la cubre isTradeable).
  if (meta.instrumentType === 'etf' || meta.instrumentType === 'commodity') {
    return meta.currentPrice != null && meta.currentPrice >= MIN_QUALITY_PRICE;
  }
  // Acciones (y tipo desconocido: fail-closed como acción)
  if (meta.marketCap == null || meta.marketCap < MIN_MARKET_CAP) return false;
  if (meta.currentPrice == null || meta.currentPrice < MIN_QUALITY_PRICE) return false;
  return true;
}
