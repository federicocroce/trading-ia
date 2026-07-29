/**
 * Vista "Hoy": un solo veredicto por cosa. Arriba tu cartera (MANTENER / VENDER); abajo,
 * oportunidades del mercado (OPERABLE / EN ESPERA). Fuente ÚNICA: lee el scan (acción, stop
 * dinámico, objetivo ya calculados ahí) + el precio en vivo. No recalcula nada por su cuenta,
 * así "Hoy" y "Oportunidades" muestran SIEMPRE los mismos números.
 */
import type { Opportunity, Price } from '@trading/shared';
import { getPortfolioPositions, getLatestOpportunityScan, getTodayProposalAppearances, getRecentStopLevels, upsertPortfolioVerdicts } from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';
import { capasConStopDuro, concentrationCaveatFor, decidePositionVerb, resolvePositionPrice, sizingCaveatFor, stopAplicaEnCapa, timingCaveatFor, type PortfolioVerb } from './today-decisions.js';
import { layerForSymbol } from '../portfolio/allocation-plan.js';
import { getPortfolioConcentration, APUESTAS_CONCENTRADA } from '../portfolio/concentration.service.js';
import { getRegimes, assetClassOf, type Regimes } from '../quant/risk.service.js';
import { suggestPositionSize } from '../quant/risk.js';
import { selectTodayProposals, verbFor, chronicAdjustment, stopBreachAdjustment, stopBreachLookbackDays, thesisConflictCaveat, type MarketVerb } from './today-proposals.js';
// Convergencia (regla #4): las tesis gatilladas aparecen EN Hoy — única superficie de decisión.
// Solo LECTURA de theses; nada del scan importa hacia allá (la frontera sigue intacta).
import { getActiveTheses } from '../db/repository.js';

export type { MarketVerb };

export interface TodayPosition {
  symbol: string;
  verb: PortfolioVerb;
  reason: string;
  warning?: string;
  /** El motor lo ve como compra y ya lo tenés → podés sumar (un solo card, sin doble discurso). */
  canAdd: boolean;
  /** Aditivo. AD-016: por qué no se habilita sumar aunque el motor diga BUY. */
  concentrationCaveat?: string;
  avgCost: number;
  currentPrice: number;
  gainPct: number;
  stop: number | null;
  target: number | null;
  value: number;
  pnl: number;
}

export interface TodayOpportunity {
  symbol: string;
  verb: MarketVerb;
  reason: string;
  /** Coherencia: el timing técnico del mismo scan contradice al verbo (ej. OPERABLE + timing SELL). */
  timingCaveat?: string;
  /** Enésima aparición en el top de Hoy (contando hoy). null = sin registro — no se inventa. */
  appearances: number | null;
  /** Regla del residente crónico (4ª+ aparición): viaja con la card, cita la evidencia. */
  persistenceCaveat?: string;
  /** Regla de stop perforado (patología NEM): precio bajo un stop reciente del sistema = 32% win / −0.15R. */
  cooldownCaveat?: string;
  /** Aditivo. Por qué no hay tamaño sugerido cuando la cartera no se pudo valuar entera. */
  sizingCaveat?: string;
  /** Relación con TU cartera (del scan): diversifica / apila / neutral, con la razón. null = scan viejo sin el dato. */
  diversification?: { verdict: 'stacks' | 'diversifies' | 'neutral'; reason: string } | null;
  /**
   * El motor le encontró setup de entrada válido HOY (acción cruda = BUY). Es un hecho sobre
   * el papel, NO una predicción de que rinda mejor: medido contra SPY, tener setup no midió
   * mejor retorno que no tenerlo (prompt maestro §4). Existe porque `verb` solo no alcanza —
   * un WATCH crónico y un BUY crónico son ambos EN ESPERA, y la UI necesita separarlos.
   */
  hasEntrySetup: boolean;
  /** Se sigue enviando para no romper consumidores, pero la UI de Hoy ya no lo muestra (§4). */
  score: number;
  currentPrice: number;
  assetClass: 'us' | 'crypto' | 'argentina';
  entry?: number;
  stop?: number;
  target?: number;
  /** Sizing por riesgo (arriesga ~1% del portfolio según la distancia al stop). */
  suggestedShares?: number;
  suggestedDollars?: number;
}

/** Tesis gatillada visible en Hoy: la opinión tocó su entrada — decisión del dueño, arbitrada. */
export interface TriggeredThesis {
  id: number;
  title: string;
  direction: string;
  primarySymbol: string;
  entryTriggerPrice: number;
  invalidationPrice: number;
  horizonDays: number;
  createdDate: string;
  triggeredAt: string | null;
  narrative: string;
  /** Verbo del scan para el mismo símbolo hoy (cartera u oportunidades), null si no está. */
  scanVerb: string | null;
  /** Presente solo si tesis y scan apuntan en direcciones opuestas — el scan manda. */
  conflictCaveat: string | null;
}

export interface TodayView {
  generatedAt: string;
  portfolio: TodayPosition[];
  opportunities: TodayOpportunity[];
  /** Aditivo (regla #4): tesis gatilladas convergen en Hoy — nada accionable vive solo en otra tab. */
  triggeredTheses: TriggeredThesis[];
  regimes: Regimes;
  portfolioValue: number;
  scanDate?: string;
  /**
   * AD-016. Aditivo. Un hecho de la CARTERA, no de cada símbolo: va una vez, arriba de las
   * oportunidades. Repetirlo en las ~101 tarjetas sería ruido (objetivo #3). null = sin freno,
   * o sin datos para afirmarlo — nunca significa "cartera repartida".
   */
  concentrationCaveat: string | null;
  /**
   * Aditivo (regla #4). AD-015: cuántas posiciones se pudieron juzgar de verdad y cuáles no.
   * Sin esto, una posición sin precio desaparecía de la vista sin dejar rastro y el registro
   * del guardián se veía completo. `stopsAsOf` es la fecha del scan del que salen los stops:
   * un stop que no se recalcula hace días es más bajo de lo que corresponde (el chandelier
   * solo sube), o sea protege menos de lo que la vista aparenta.
   */
  portfolioCoverage: {
    total: number;
    evaluated: number;
    stalePriced: number;
    dropped: Array<{ symbol: string; reason: string }>;
    stopsAsOf: string | null;
    /** El valor de cartera —y todo sizing derivado— está calculado sobre una base incompleta. */
    valueIsPartial: boolean;
  };
}

const URGENCY: Record<PortfolioVerb, number> = { VENDER: 0, REVISAR: 1, MANTENER: 2 };
const round2 = (n: number) => Math.round(n * 100) / 100;

function pickReason(o: Opportunity): string {
  return (
    o.simpleReasoning?.trim() ||
    o.reasoning?.trim() ||
    o.catalysts?.find((c) => c?.trim())?.trim() ||
    ''
  );
}

export async function getTodayDecisions(): Promise<TodayView> {
  const positions = getPortfolioPositions();
  const scan = getLatestOpportunityScan();
  const opps: Opportunity[] = scan ? JSON.parse(scan.opportunities) : [];
  const bySymbol = new Map(opps.map((o) => [o.symbol.toUpperCase(), o]));

  const generatedAt = new Date().toISOString();
  const heldSet = new Set(positions.map((p) => p.symbol.toUpperCase()));

  // --- Cartera --- (precio en vivo; stop/objetivo/acción los toma del scan: fuente única)
  const heldSymbols = positions.map((p) => p.symbol);
  const quoteBySym = new Map<string, Price>();
  if (heldSymbols.length > 0) {
    const quotes = await getQuotes(heldSymbols).catch(() => []);
    for (const q of quotes) quoteBySym.set(q.symbol.toUpperCase(), q);
  }

  // Veredicto por CIERRE confirmado (no por toque intradiario). Gateado para validar forward:
  // EXIT_ON_CLOSE=1 lo activa; por defecto OFF → comportamiento idéntico al actual.
  const exitOnClose = process.env.EXIT_ON_CLOSE === '1' || process.env.EXIT_ON_CLOSE === 'true';

  // AD-016: la concentración deja de ser una tarjeta y pasa a frenar aportes. Solo DEGRADA.
  // Cacheado 10 min en su servicio — no cuesta red en cada carga. Fail-soft: si falla, no se
  // afirma nada (null), jamás se asume "cartera repartida".
  let concentracionCaveat: string | null = null;
  try {
    const conc = await getPortfolioConcentration();
    concentracionCaveat = concentrationCaveatFor(conc, APUESTAS_CONCENTRADA);
  } catch (err) {
    console.warn('[today] Concentración no disponible — sin freno por concentración:', (err as Error).message);
  }

  // AD-015: toda posición que NO se pueda evaluar se REPORTA. Antes se hacía `continue` y
  // desaparecía de la vista y del registro, que quedaba pareciendo completo.
  const descartadas: Array<{ symbol: string; reason: string }> = [];
  let conPrecioViejo = 0;

  // Opción B: el stop duro solo manda en la capa `riesgo`. Se lee una vez por corrida.
  const capasStop = capasConStopDuro();

  const portfolio: TodayPosition[] = [];
  for (const p of positions) {
    const sym = p.symbol.toUpperCase();
    const capa = layerForSymbol(sym);
    if (p.avgCost <= 0) {
      descartadas.push({ symbol: p.symbol, reason: 'Costo promedio inválido (≤0) — no se puede calcular resultado ni juzgar el stop.' });
      continue;
    }
    const opp = bySymbol.get(sym);
    const q = quoteBySym.get(sym);
    const precio = resolvePositionPrice(q, opp, scan?.scannedAt?.slice(0, 10) ?? null);
    if (precio == null) {
      descartadas.push({ symbol: p.symbol, reason: 'Sin cotización viva y sin precio en el último scan — la posición NO está siendo vigilada.' });
      continue;
    }
    const currentPrice = precio.price;
    if (precio.isStale) conPrecioViejo++;

    const trailingStop = opp?.trailingStop ?? null;
    const target = opp?.tradeLevels?.takeProfit ?? null;
    const engineAction = opp?.action;

    // En sesión (REGULAR) el spot es provisional → se decide por el último cierre (previousClose).
    // Fuera de sesión, el regularMarketPrice ya es el cierre del día.
    const intraday = exitOnClose && q?.marketState === 'REGULAR';
    const closePrice = exitOnClose
      ? (intraday ? (q && q.previousClose > 0 ? q.previousClose : currentPrice) : currentPrice)
      : undefined;

    const v = decidePositionVerb({
      avgCost: p.avgCost,
      currentPrice,
      trailingStop,
      target,
      engineWarnsSell: engineAction === 'SELL',
      engineSellReason: engineAction === 'SELL' && opp ? pickReason(opp) || undefined : undefined,
      closePrice,
      intraday,
      priceIsStale: precio.isStale,
      priceAsOf: precio.asOf,
      hardStopApplies: stopAplicaEnCapa(capa, capasStop),
    });

    portfolio.push({
      symbol: p.symbol,
      verb: v.verb,
      reason: v.reason,
      warning: v.warning,
      // AD-016: con la cartera concentrada, sumar a lo que ya tenés es exactamente el riesgo
      // que ningún stop cubre. Solo degrada: nunca habilita un canAdd que el motor no dio.
      // El freno por concentración aplica SOLO a la capa riesgo. Bloquear un aporte a SPY o a
      // GLD sería exactamente al revés: el núcleo y la cobertura son el antídoto de una cartera
      // concentrada, no lo que la empeora. (Defecto introducido con AD-016 y corregido acá.)
      canAdd: v.verb === 'MANTENER' && engineAction === 'BUY' && (capa !== 'riesgo' || concentracionCaveat == null),
      // Solo viaja donde efectivamente FRENÓ algo: si el motor no daba BUY, no hay nada que
      // frenar y un caveat acá sería ruido en las 8 tarjetas.
      concentrationCaveat: (capa === 'riesgo' && v.verb === 'MANTENER' && engineAction === 'BUY' && concentracionCaveat != null)
        ? concentracionCaveat : undefined,
      avgCost: round2(p.avgCost),
      currentPrice: round2(currentPrice),
      gainPct: v.gainPct,
      stop: v.stop,
      target: v.target,
      value: round2(currentPrice * p.quantity),
      pnl: round2((currentPrice - p.avgCost) * p.quantity),
    });
  }
  portfolio.sort((a, b) => URGENCY[a.verb] - URGENCY[b.verb] || b.value - a.value);

  // Registro del guardián (2026-07-28). Hasta hoy este veredicto se calculaba, se pintaba y
  // se tiraba: el objetivo #1 del proyecto era inmedible por construcción. Se persiste lo
  // que el dueño efectivamente VE (upsert por día+símbolo, última vista gana).
  // Fail-soft a propósito: un fallo de escritura JAMÁS puede tumbar la vista de decisión —
  // preferimos perder un registro antes que dejar al dueño sin ver su stop.
  // Cantidad tenida: convierte el registro diario en bitácora implícita de operaciones —
  // si cambia entre dos días, hubo compra o venta. `transactions` depende de carga manual y
  // se cortó el 2026-05-04; esto se llena solo cada vez que el dueño abre Hoy.
  const cantidadPorSimbolo = new Map(positions.map((p) => [p.symbol.toUpperCase(), p.quantity]));

  try {
    const escritos = upsertPortfolioVerdicts(
      portfolio.map((p) => ({
        verdictDate: generatedAt.slice(0, 10),
        symbol: p.symbol,
        verb: p.verb,
        reason: p.reason,
        currentPrice: p.currentPrice,
        avgCost: p.avgCost,
        gainPct: p.gainPct,
        stop: p.stop,
        target: p.target,
        positionValue: p.value,
        quantity: cantidadPorSimbolo.get(p.symbol.toUpperCase()) ?? null,
        warning: p.warning ?? null,
      })),
    );
    if (escritos > 0) console.log(`[Hoy] ${escritos} veredictos del guardián registrados`);
  } catch (err) {
    console.warn('[Hoy] No se pudo registrar el veredicto del guardián:', (err as Error).message);
  }

  // Columna de riesgo: régimen por clase de activo + valor de cartera para el sizing.
  const regimes = await getRegimes();
  const portfolioValue = round2(portfolio.reduce((s, p) => s + p.value, 0));
  // OJO: portfolioValue suma solo las EVALUADAS. Si alguna quedó afuera, esta base está
  // incompleta y no se puede sugerir tamaño con ella (ver sizingCaveatFor).
  const sizingCaveat = sizingCaveatFor(descartadas.map((d) => d.symbol));


  // --- Mercado: solo lo que NO tenés (excluye la cartera real → sin doble discurso) ---
  const scanDay = scan?.scannedAt?.slice(0, 10) ?? generatedAt.slice(0, 10);
  const candidates = selectTodayProposals(opps, heldSet);
  // Enésima aparición: días previos registrados + 1 (hoy). Sin filas previas ni registro
  // del propio scan (tabla recién creada) el prior es 0 → appearances = 1, honesto.
  const priorAppearances = getTodayProposalAppearances(candidates.map((c) => c.symbol), scanDay);
  // Stops recientes (excluyendo el scan de hoy) para la regla de perforación.
  const breachSince = new Date(new Date(scanDay + 'T00:00:00Z').getTime() - stopBreachLookbackDays() * 86_400_000)
    .toISOString().slice(0, 10);
  const recentStops = getRecentStopLevels(candidates.map((c) => c.symbol), breachSince, scanDay);

  const opportunities: TodayOpportunity[] = candidates.map((o) => {
    const entry = o.tradeLevels?.entryPrice;
    const stop = o.tradeLevels?.stopLoss;
    // Fail-closed: con la cartera incompleta el sizing saldría chico y nadie lo notaría.
    const size = sizingCaveat == null && entry != null && stop != null && portfolioValue > 0
      ? suggestPositionSize({ portfolioValue, entry, stop })
      : null;
    const nth = (priorAppearances.get(o.symbol) ?? 0) + 1;
    const adj = chronicAdjustment(verbFor(o.action), nth);
    // Composición de degradaciones: cualquiera de las dos reglas puede bajar el verbo, ninguna subirlo.
    const cd = stopBreachAdjustment(adj.verb, o.currentPrice, recentStops.get(o.symbol) ?? null);
    return {
      symbol: o.symbol,
      verb: cd.verb,
      reason: pickReason(o),
      timingCaveat: timingCaveatFor(cd.verb, o.timingView),
      appearances: nth,
      persistenceCaveat: adj.caveat,
      cooldownCaveat: cd.caveat,
      sizingCaveat: sizingCaveat ?? undefined,
      diversification: o.portfolioAdjustment
        ? { verdict: o.portfolioAdjustment.verdict, reason: o.portfolioAdjustment.reason }
        : null,
      hasEntrySetup: o.action === 'BUY',
      score: Math.round(o.opportunityScore),
      currentPrice: round2(o.currentPrice),
      assetClass: assetClassOf(o.symbol),
      entry,
      stop,
      target: o.tradeLevels?.takeProfit,
      suggestedShares: size?.shares,
      suggestedDollars: size?.dollars,
    };
  });

  // Tesis gatilladas → Hoy, con arbitraje explícito contra el verbo del scan del mismo símbolo.
  // Fail-closed liviano: si la lectura de tesis falla, Hoy sale igual (sin la sección, con log).
  let triggeredTheses: TriggeredThesis[] = [];
  try {
    const verbBySymbol = new Map<string, string>();
    for (const o of opportunities) verbBySymbol.set(o.symbol.toUpperCase(), o.verb);
    for (const p of portfolio) verbBySymbol.set(p.symbol.toUpperCase(), p.verb);
    triggeredTheses = getActiveTheses()
      .filter((t) => t.status === 'gatillada')
      .map((t) => {
        const scanVerb = verbBySymbol.get(t.primarySymbol.toUpperCase()) ?? null;
        return {
          id: t.id,
          title: t.title,
          direction: t.direction,
          primarySymbol: t.primarySymbol,
          entryTriggerPrice: t.entryTriggerPrice,
          invalidationPrice: t.invalidationPrice,
          horizonDays: t.horizonDays,
          createdDate: t.createdDate,
          triggeredAt: t.triggeredAt,
          narrative: t.narrative,
          scanVerb,
          conflictCaveat: thesisConflictCaveat(t.direction, scanVerb),
        };
      });
  } catch (err) {
    console.warn('[today] Lectura de tesis gatilladas falló:', (err as Error).message);
  }

  return {
    generatedAt, portfolio, opportunities, triggeredTheses, regimes, portfolioValue,
    scanDate: scan?.scannedAt,
    concentrationCaveat: concentracionCaveat,
    portfolioCoverage: {
      total: positions.length,
      evaluated: portfolio.length,
      stalePriced: conPrecioViejo,
      dropped: descartadas,
  stopsAsOf: scan?.scannedAt?.slice(0, 10) ?? null,
      valueIsPartial: descartadas.length > 0,
    },
  };
}
