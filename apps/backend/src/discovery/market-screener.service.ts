/**
 * Orquestador del screener de mercado: franja diaria del universo → quotes en lote →
 * anti-chase → filtro de tendencia → validación técnica (setupQuality/RR) → registro en
 * discovered_symbols con source='screener'.
 *
 * ⚠️ CAMBIO DE FUENTE 2026-07-28 — se cerró la última puerta de ATENCIÓN.
 * Antes partía de `most_actives`/`day_gainers`/`day_losers` de Yahoo y ordenaba por volumen:
 * exactamente el mismo mecanismo que se apagó en la nominación por prensa (mirar dónde está
 * la multitud), con otra puerta de entrada. El filtro posterior es duro y estructural, pero
 * un filtro duro sobre una lista sesgada deja un subconjunto de la lista sesgada.
 *
 * Ahora parte del universo por LIQUIDEZ (`sweep-universe.json`, ~3.000 símbolos que pasan la
 * quality bar) y recorre una FRANJA DISTINTA cada día (`daily-slice.ts`): sin ranking —
 * medido que no informa—, sin atención, cobertura completa del universo en ceil(n/size) días
 * y costo diario constante.
 *
 * Fail-closed en cada etapa: sin dato → afuera. Un símbolo cuyo `getTechnicalSummary` tira
 * (sin histórico, Yahoo caído, etc.) se descarta silenciosamente — no aborta el resto del
 * embudo.
 */

import { readFileSync } from 'node:fs';
import { getQuotes } from '../shared/yahoo.js';
import { filterScreenerCandidates } from './market-screener.js';
import { readUniverse } from './sweep-universe.js';
import { selectDailySlice, dayIndexFor } from './daily-slice.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { computeTradeLevels } from '../opportunities/scoring.js';
import { registerNovelTickers } from './discovery-registry.js';
import { envNumber } from '../shared/env-number.js';

export interface MarketScreenerResult {
  candidates: number;
  /** Candidatos que pasaron el embudo completo (tendencia + setup técnico) — no implica que ya estén registrados. */
  operables: string[];
  /** Count real devuelto por registerNovelTickers — puede ser < operables.length (ya conocidos se filtran ahí). */
  registered: number;
}

/** Universo compartido con el barrido de bases: una sola fuente de verdad de qué existe. */
const universeFile = readUniverse(
  JSON.parse(readFileSync(new URL('./sweep-universe.json', import.meta.url), 'utf-8')),
);
const universe = universeFile?.symbols ?? [];
/** Market cap de captura por símbolo: el batch v7 no lo trae y meetsQualityBar es fail-closed. */
const marketCaps = universeFile?.marketCaps ?? {};

export async function runMarketScreener(): Promise<MarketScreenerResult> {
  const minRR = envNumber('SCREENER_MIN_RR', 2);
  const sliceSize = envNumber('SCREENER_DAILY_SLICE', 300);

  // Franja del día. El universo ya pasó la barra de marketCap al generarse, así que acá
  // solo falta lo que cambia a diario: precio vivo y movimiento (anti-chase).
  const slice = selectDailySlice(universe, sliceSize, dayIndexFor(new Date()));
  if (slice.length === 0) {
    console.warn('[Screener] universo vacío — correr: npm run db:refresh-universe');
    return { candidates: 0, operables: [], registered: 0 };
  }

  const prices = await getQuotes(slice);
  const quotes = prices.map((p) => ({
    symbol: p.symbol,
    name: p.symbol,
    price: p.current,
    changePct: p.changePercent,
    volume: 0,                                  // el orden por volumen se eliminó: era atención
    marketCap: marketCaps[p.symbol] ?? null,    // del universo; null ⇒ la quality bar lo rechaza
  }));
  // La FRANJA es el presupuesto: sin este override, SCREENER_MAX_CANDIDATES (40) volvería a
  // cortar y solo 40 de los 300 llegarían a la etapa técnica — la vuelta completa pasaría de
  // 11 a 76 días, y el log lo estaría reportando mal.
  // MEDIDO en corrida real (2026-07-28): franja de 300 → 299 pasan el embudo barato → 15
  // operables → 212s en total. Entra en la ventana pre-market. Si se sube SCREENER_DAILY_SLICE
  // el tiempo escala ~lineal: ~0.7s por símbolo.
  const cheap = filterScreenerCandidates(quotes, { maxCandidates: slice.length });

  const operables: string[] = [];
  for (const c of cheap) {
    try {
      const tech = await getTechnicalSummary(c.symbol);
      // Alineado con el anti-hype strict: mismo chequeo de tendencia que el Filter 1 de
      // applyAntiHypeFilters (scoring.ts:696) — precio > SMA200. No reusamos esa función
      // directamente porque tolera 1 de 3 fallos (MAX_FAILURES) y acá no están los otros 2
      // filtros (RSI/volumen) para compensar un solo dato faltante — replicamos SOLO la
      // comparación de tendencia. Fail-closed: SMA200 ausente descarta (applyAntiHypeFilters,
      // en cambio, deja pasar el símbolo entero cuando no hay `tech`).
      const ind = tech.indicators;
      if (ind.sma200 == null || ind.currentPrice <= ind.sma200) continue;

      const levels = computeTradeLevels(tech, 'BUY');
      if (levels?.setupQuality === 'valid' && (levels.riskRewardRatio ?? 0) >= minRR) {
        operables.push(c.symbol);
      }
    } catch {
      // símbolo sin datos técnicos (histórico ausente, Yahoo caído): fuera, fail-closed.
    }
  }

  let registered = 0;
  if (operables.length > 0) {
    registered = await registerNovelTickers(operables, 'screener');
  }

  const vueltaDias = Math.ceil(universe.length / sliceSize);
  console.log(
    `[Screener] franja ${slice.length}/${universe.length} del universo (vuelta completa cada ${vueltaDias} días) → ` +
    `quotes ${quotes.length} → embudo ${cheap.length} → operables ${operables.length} → registrados ${registered}: ${operables.slice(0, 10).join(', ')}`,
  );

  return { candidates: cheap.length, operables, registered };
}
