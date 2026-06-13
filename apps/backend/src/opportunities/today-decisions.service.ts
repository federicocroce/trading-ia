/**
 * Vista "Hoy": un solo veredicto por cosa. Arriba tu cartera (MANTENER / VENDER); abajo,
 * oportunidades del mercado (COMPRAR / OBSERVAR). Fuente ÚNICA: lee el scan (acción, stop
 * dinámico, objetivo ya calculados ahí) + el precio en vivo. No recalcula nada por su cuenta,
 * así "Hoy" y "Oportunidades" muestran SIEMPRE los mismos números.
 */
import type { Opportunity } from '@trading/shared';
import { getPortfolioPositions, getLatestOpportunityScan } from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';
import { decidePositionVerb, type PortfolioVerb } from './today-decisions.js';

export type MarketVerb = 'COMPRAR' | 'OBSERVAR';

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
  score: number;
  currentPrice: number;
  entry?: number;
  stop?: number;
  target?: number;
}

export interface TodayView {
  generatedAt: string;
  portfolio: TodayPosition[];
  opportunities: TodayOpportunity[];
  scanDate?: string;
}

const URGENCY: Record<PortfolioVerb, number> = { VENDER: 0, MANTENER: 1 };
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
  const prices = new Map<string, number>();
  if (heldSymbols.length > 0) {
    const quotes = await getQuotes(heldSymbols).catch(() => []);
    for (const q of quotes) prices.set(q.symbol.toUpperCase(), q.current);
  }

  const portfolio: TodayPosition[] = [];
  for (const p of positions) {
    if (p.avgCost <= 0) continue;
    const sym = p.symbol.toUpperCase();
    const opp = bySymbol.get(sym);
    const currentPrice = prices.get(sym) ?? opp?.currentPrice ?? 0;
    if (currentPrice <= 0) continue;

    const trailingStop = opp?.trailingStop ?? null;
    const target = opp?.tradeLevels?.takeProfit ?? null;
    const engineAction = opp?.action;
    const v = decidePositionVerb({ avgCost: p.avgCost, currentPrice, trailingStop, target, engineWarnsSell: engineAction === 'SELL' });

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

  // --- Mercado: solo lo que NO tenés (excluye la cartera real → sin doble discurso) ---
  const opportunities: TodayOpportunity[] = opps
    .filter((o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 6)
    .map((o) => ({
      symbol: o.symbol,
      verb: o.action === 'BUY' ? 'COMPRAR' : 'OBSERVAR',
      reason: pickReason(o),
      score: Math.round(o.opportunityScore),
      currentPrice: round2(o.currentPrice),
      entry: o.tradeLevels?.entryPrice,
      stop: o.tradeLevels?.stopLoss,
      target: o.tradeLevels?.takeProfit,
    }));

  return { generatedAt, portfolio, opportunities, scanDate: scan?.scannedAt };
}
