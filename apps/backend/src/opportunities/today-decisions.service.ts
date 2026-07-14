/**
 * Vista "Hoy": un solo veredicto por cosa. Arriba tu cartera (MANTENER / VENDER); abajo,
 * oportunidades del mercado (COMPRAR / OBSERVAR). Fuente ÚNICA: lee el scan (acción, stop
 * dinámico, objetivo ya calculados ahí) + el precio en vivo. No recalcula nada por su cuenta,
 * así "Hoy" y "Oportunidades" muestran SIEMPRE los mismos números.
 */
import type { Opportunity, Price } from '@trading/shared';
import { getPortfolioPositions, getLatestOpportunityScan, getTodayProposalAppearances } from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';
import { decidePositionVerb, timingCaveatFor, type PortfolioVerb } from './today-decisions.js';
import { getRegimes, assetClassOf, type Regimes } from '../quant/risk.service.js';
import { suggestPositionSize } from '../quant/risk.js';
import { selectTodayProposals, verbFor, chronicAdjustment, type MarketVerb } from './today-proposals.js';

export type { MarketVerb };

export interface TodayPosition {
  symbol: string;
  verb: PortfolioVerb;
  reason: string;
  warning?: string;
  /** El motor lo ve como compra y ya lo tenés → podés sumar (un solo card, sin doble discurso). */
  canAdd: boolean;
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
  /** Coherencia: el timing técnico del mismo scan contradice al verbo (ej. COMPRAR + timing SELL). */
  timingCaveat?: string;
  /** Enésima aparición en el top de Hoy (contando hoy). null = sin registro — no se inventa. */
  appearances: number | null;
  /** Regla del residente crónico (4ª+ aparición): viaja con la card, cita la evidencia. */
  persistenceCaveat?: string;
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

export interface TodayView {
  generatedAt: string;
  portfolio: TodayPosition[];
  opportunities: TodayOpportunity[];
  regimes: Regimes;
  portfolioValue: number;
  scanDate?: string;
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

  const portfolio: TodayPosition[] = [];
  for (const p of positions) {
    if (p.avgCost <= 0) continue;
    const sym = p.symbol.toUpperCase();
    const opp = bySymbol.get(sym);
    const q = quoteBySym.get(sym);
    const currentPrice = q?.current ?? opp?.currentPrice ?? 0;
    if (currentPrice <= 0) continue;

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
    });

    portfolio.push({
      symbol: p.symbol,
      verb: v.verb,
      reason: v.reason,
      warning: v.warning,
      canAdd: v.verb === 'MANTENER' && engineAction === 'BUY',
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

  // Columna de riesgo: régimen por clase de activo + valor de cartera para el sizing.
  const regimes = await getRegimes();
  const portfolioValue = round2(portfolio.reduce((s, p) => s + p.value, 0));

  // --- Mercado: solo lo que NO tenés (excluye la cartera real → sin doble discurso) ---
  const scanDay = scan?.scannedAt?.slice(0, 10) ?? generatedAt.slice(0, 10);
  const candidates = selectTodayProposals(opps, heldSet);
  // Enésima aparición: días previos registrados + 1 (hoy). Sin filas previas ni registro
  // del propio scan (tabla recién creada) el prior es 0 → appearances = 1, honesto.
  const priorAppearances = getTodayProposalAppearances(candidates.map((c) => c.symbol), scanDay);

  const opportunities: TodayOpportunity[] = candidates.map((o) => {
    const entry = o.tradeLevels?.entryPrice;
    const stop = o.tradeLevels?.stopLoss;
    const size = entry != null && stop != null && portfolioValue > 0
      ? suggestPositionSize({ portfolioValue, entry, stop })
      : null;
    const nth = (priorAppearances.get(o.symbol) ?? 0) + 1;
    const adj = chronicAdjustment(verbFor(o.action), nth);
    return {
      symbol: o.symbol,
      verb: adj.verb,
      reason: pickReason(o),
      timingCaveat: timingCaveatFor(adj.verb, o.timingView),
      appearances: nth,
      persistenceCaveat: adj.caveat,
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

  return { generatedAt, portfolio, opportunities, regimes, portfolioValue, scanDate: scan?.scannedAt };
}
