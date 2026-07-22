import { envNumber } from '../shared/env-number.js';

/**
 * Plan de asignación por capas de la cartera (núcleo / cobertura / riesgo). Función pura,
 * sin I/O: recibe posiciones ya valuadas (precio vivo resuelto afuera) y devuelve un breakdown
 * más un plan de aportes. Fail-closed: cualquier dato no confiable aborta el plan entero.
 */

// Whitelist estática de capas defensivas. Todo lo que no matchea es "riesgo" (acciones, cripto, etc).
const NUCLEO_ETFS = ['SPY', 'VOO', 'IVV', 'QQQ', 'VT', 'VTI', 'ACWI'];
const COBERTURA_ETFS = ['GLD', 'IAU', 'SGOL', 'GLDM', 'TLT', 'IEF', 'SHV', 'BIL'];

export type CarteraLayer = 'nucleo' | 'cobertura' | 'riesgo';

/** Clasifica un símbolo en su capa de cartera (whitelist, case-insensitive). */
export function layerForSymbol(symbol: string): CarteraLayer {
  const upper = symbol.toUpperCase();
  if (NUCLEO_ETFS.includes(upper)) return 'nucleo';
  if (COBERTURA_ETFS.includes(upper)) return 'cobertura';
  return 'riesgo';
}

export interface AllocationInput {
  positions: Array<{ symbol: string; value: number; currentPrice: number }>;
  newCashUsd: number;
}

export interface LayerBreakdown {
  layer: CarteraLayer;
  value: number;
  pct: number;
  targetPct: number;
}

export interface AllocationPlanOk {
  ok: true;
  totalValue: number;
  layers: LayerBreakdown[];
  violations: string[]; // texto en español, una por regla violada
  contributions: Array<{ layer: CarteraLayer; usd: number; instruments: string[]; nota: string }>;
  /** Excedente sin destino: mantener líquido — nuevos targets el próximo rebalanceo o setups del scan. */
  unallocatedUsd: number;
}

export interface AllocationPlanFail {
  ok: false;
  reason: string;
}

export type AllocationPlan = AllocationPlanOk | AllocationPlanFail;

const LAYERS: CarteraLayer[] = ['nucleo', 'cobertura', 'riesgo'];

const INSTRUMENTS_BY_LAYER: Record<CarteraLayer, string[]> = {
  nucleo: ['SPY'],
  cobertura: ['GLD'],
  riesgo: [],
};

/** Construye el plan de asignación por capas. Puro (sin I/O), fail-closed. */
export function buildAllocationPlan(input: AllocationInput): AllocationPlan {
  const { positions, newCashUsd } = input;

  // Regla 1: fail-closed — cualquier posición sin precio/valor vivo aborta el plan entero.
  for (const p of positions) {
    const sinPrecioVivo =
      !Number.isFinite(p.value) || p.value <= 0 || !Number.isFinite(p.currentPrice) || p.currentPrice <= 0;
    if (sinPrecioVivo) {
      return { ok: false, reason: `Sin precio vivo de ${p.symbol} — plan no generado` };
    }
  }
  if (positions.length === 0 && newCashUsd === 0) {
    return { ok: false, reason: 'Cartera vacía y sin aporte' };
  }
  if (!Number.isFinite(newCashUsd) || newCashUsd < 0) {
    return { ok: false, reason: 'Aporte inválido — plan no generado' };
  }

  // Regla 3: targets configurables (envNumber lazy — se leen acá adentro, nunca a nivel módulo).
  const targetNucleo = envNumber('CARTERA_TARGET_NUCLEO', 55);
  const targetCobertura = envNumber('CARTERA_TARGET_COBERTURA', 12);
  const targetRiesgo = 100 - targetNucleo - targetCobertura;
  const targetPctByLayer: Record<CarteraLayer, number> = {
    nucleo: targetNucleo,
    cobertura: targetCobertura,
    riesgo: targetRiesgo,
  };

  const maxRiesgo = envNumber('CARTERA_MAX_RIESGO', 35);
  const maxPosicion = envNumber('CARTERA_MAX_POSICION', 20);

  const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
  const totalPostAporte = totalValue + newCashUsd; // el plan mira la cartera POST-aporte

  const valueByLayer: Record<CarteraLayer, number> = { nucleo: 0, cobertura: 0, riesgo: 0 };
  for (const p of positions) {
    valueByLayer[layerForSymbol(p.symbol)] += p.value;
  }

  const layers: LayerBreakdown[] = LAYERS.map((layer) => ({
    layer,
    value: valueByLayer[layer],
    pct: (valueByLayer[layer] / totalPostAporte) * 100,
    targetPct: targetPctByLayer[layer],
  }));

  // Regla 4: violaciones informativas (texto español).
  const violations: string[] = [];
  const riesgoBreakdown = layers.find((l) => l.layer === 'riesgo')!;
  if (riesgoBreakdown.pct > maxRiesgo) {
    violations.push(
      `La capa de riesgo está en ${riesgoBreakdown.pct.toFixed(1)}%, supera el máximo permitido de ${maxRiesgo}%`
    );
  }
  for (const p of positions) {
    const pctPosicion = (p.value / totalPostAporte) * 100;
    if (pctPosicion > maxPosicion) {
      violations.push(
        `${p.symbol} representa ${pctPosicion.toFixed(1)}% de la cartera, supera el máximo por posición de ${maxPosicion}%`
      );
    }
  }

  // Regla 5: reparto del aporte, proporcional al déficit en USD de las capas subponderadas.
  // El riesgo JAMÁS recibe aporte sugerido (se llena con setups del scan, no con plata fresca).
  // Cap: ninguna contribución puede exceder el déficit de su propia capa — si el aporte supera
  // el déficit total, el sobrante NO se fuerza a ninguna capa, queda explícito en unallocatedUsd.
  const contributions: AllocationPlanOk['contributions'] = [];
  let unallocatedUsd = 0;
  if (newCashUsd > 0) {
    const deficitByLayer: Partial<Record<'nucleo' | 'cobertura', number>> = {};
    for (const layer of ['nucleo', 'cobertura'] as const) {
      const targetUsd = (targetPctByLayer[layer] / 100) * totalPostAporte;
      const deficit = Math.max(0, targetUsd - valueByLayer[layer]);
      if (deficit > 0) deficitByLayer[layer] = deficit;
    }

    const sumDeficits = (deficitByLayer.nucleo ?? 0) + (deficitByLayer.cobertura ?? 0);

    if (sumDeficits > 0) {
      const shares: Array<{ layer: 'nucleo' | 'cobertura'; deficit: number; usd: number }> = [];
      let sumRounded = 0;
      for (const layer of ['nucleo', 'cobertura'] as const) {
        const deficit = deficitByLayer[layer];
        if (deficit === undefined) continue;
        const proporcional = (newCashUsd * deficit) / sumDeficits;
        const capeado = Math.min(proporcional, deficit); // fix ALTA: jamás por encima del déficit propio
        const rounded = Math.floor(capeado);
        shares.push({ layer, deficit, usd: rounded });
        sumRounded += rounded;
      }
      // Redondeo a enteros de USD: el residuo (por floor, o por el cap de arriba) intenta entrar
      // primero en la capa con mayor déficit, luego en la otra, respetando siempre el cap de cada
      // una; lo que no tiene destino (sobra el déficit total) queda en unallocatedUsd.
      let residual = newCashUsd - sumRounded;
      const ordenPorDeficit = [...shares].sort((a, b) => b.deficit - a.deficit);
      for (const s of ordenPorDeficit) {
        if (residual <= 0) break;
        const espacio = Math.floor(s.deficit) - s.usd;
        const aplicar = Math.min(residual, Math.max(0, espacio));
        if (aplicar > 0) {
          s.usd += aplicar;
          residual -= aplicar;
        }
      }
      unallocatedUsd += residual;

      for (const s of shares) {
        contributions.push({
          layer: s.layer,
          usd: s.usd,
          instruments: INSTRUMENTS_BY_LAYER[s.layer],
          nota: 'Aporte sugerido para acercar la capa al target',
        });
      }
    } else {
      // Ninguna capa defensiva está subponderada: el aporte entero queda líquido (sin destino).
      unallocatedUsd += newCashUsd;
    }

    // El riesgo puede estar subponderado, pero jamás recibe aporte: se explicita con nota y usd 0.
    if (riesgoBreakdown.pct < targetRiesgo) {
      contributions.push({
        layer: 'riesgo',
        usd: 0,
        instruments: INSTRUMENTS_BY_LAYER.riesgo,
        nota: 'El riesgo se llena con setups del scan, no con aportes',
      });
    }
  }

  return { ok: true, totalValue, layers, violations, contributions, unallocatedUsd };
}
