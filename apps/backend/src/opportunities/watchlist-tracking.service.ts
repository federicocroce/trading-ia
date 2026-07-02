import {
  insertWatchlistItem,
  getOpenWatchlistItem,
  getLiveWatchlistItems,
  getActiveWatchlistItems,
  updateWatchlistItemEvaluation,
  archiveWatchlistItemBySymbol,
  deleteSymbol,
} from '../db/repository.js';
import { getQuote } from '../shared/yahoo.js';
import { resolveWatchlistStatus, type WatchlistStatus } from './watchlist-resolver.js';

const DEFAULT_HORIZON_DAYS = 30;

/** Snapshot de la recomendación al momento de agregar al watchlist. */
export interface WatchlistEntryInput {
  price?: number;
  action?: string;            // SignalAction (BUY/SELL/WATCH/HOLD); ausente → manual
  score?: number | null;
  confidence?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  thesis?: string | null;
  horizonDays?: number;
}

/** Forma liviana que consume la UI. */
export interface WatchlistStatusItem {
  symbol: string;
  status: WatchlistStatus | 'archived';
  source: string;
  addedAt: string;
  entryPrice: number;
  entryAction: string;
  targetPrice: number | null;
  stopLoss: number | null;
  thesis: string | null;
  lastReturn: number | null;
  resolutionReturn: number | null;
  resolvedAt: string | null;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Captura el contexto de un alta al watchlist. Idempotente por símbolo:
 * si ya hay un item `live`, no duplica. Si no vino precio (alta manual vieja),
 * intenta cotizarlo — sin precio no se puede trackear y se omite.
 *
 * Devuelve { created } para que el caller sepa si se creó el seguimiento.
 */
export async function captureWatchlistEntry(
  symbol: string,
  entry?: WatchlistEntryInput,
): Promise<{ created: boolean }> {
  if (getOpenWatchlistItem(symbol)) return { created: false };

  let entryPrice = entry?.price ?? 0;
  if (!(entryPrice > 0)) {
    try {
      const q = await getQuote(symbol);
      entryPrice = q?.current ?? 0;
    } catch {
      entryPrice = 0;
    }
  }
  if (!(entryPrice > 0)) return { created: false };

  const isManual = !entry?.action || entry.action === 'manual';

  insertWatchlistItem({
    symbol,
    addedAt: today(),
    source: isManual ? 'manual' : 'recommendation',
    entryPrice,
    entryAction: isManual ? 'manual' : entry!.action!,
    entryScore: entry?.score ?? null,
    entryConfidence: entry?.confidence ?? null,
    targetPrice: entry?.targetPrice ?? null,
    stopLoss: entry?.stopLoss ?? null,
    thesis: entry?.thesis ?? null,
    horizonDays: entry?.horizonDays ?? DEFAULT_HORIZON_DAYS,
  });

  return { created: true };
}

/**
 * Evalúa cada item `live` contra el precio actual y persiste su estado.
 * Corre al arranque del scan + on-demand. Devuelve cuántos se cerraron.
 */
export async function resolveWatchlistItems(): Promise<number> {
  const live = getLiveWatchlistItems();
  const now = new Date();
  let resolved = 0;

  for (const item of live) {
    try {
      const q = await getQuote(item.symbol);
      if (!q || q.current <= 0) continue;

      const daysSince = Math.floor(
        (now.getTime() - new Date(item.addedAt).getTime()) / (1000 * 60 * 60 * 24),
      );

      const r = resolveWatchlistStatus({
        entryAction: item.entryAction,
        entryPrice: item.entryPrice,
        targetPrice: item.targetPrice,
        stopLoss: item.stopLoss,
        currentPrice: q.current,
        daysSince,
        horizonDays: item.horizonDays,
      });

      const nowIso = now.toISOString();
      const isResolved = r.status !== 'live';

      updateWatchlistItemEvaluation(item.id, {
        status: r.status,
        lastPrice: q.current,
        lastReturn: r.returnPct,
        lastEvaluatedAt: nowIso,
        resolvedAt: isResolved ? nowIso : null,
        resolutionPrice: isResolved ? q.current : null,
        resolutionReturn: isResolved ? r.returnPct : null,
      });

      if (isResolved) resolved++;
    } catch {
      // error de red — reintenta en la próxima corrida
    }
  }

  return resolved;
}

/** Items visibles del watchlist (no archivados) con su estado, para la UI. */
export function getWatchlistStatusList(): WatchlistStatusItem[] {
  return getActiveWatchlistItems().map((i) => ({
    symbol: i.symbol,
    status: i.status as WatchlistStatus | 'archived',
    source: i.source,
    addedAt: i.addedAt,
    entryPrice: i.entryPrice,
    entryAction: i.entryAction,
    targetPrice: i.targetPrice,
    stopLoss: i.stopLoss,
    thesis: i.thesis,
    lastReturn: i.lastReturn,
    resolutionReturn: i.resolutionReturn,
    resolvedAt: i.resolvedAt,
  }));
}

/**
 * Archiva un item (lo saca de "Para revisar") y lo remueve del watchlist
 * visible (soft-delete del símbolo, mismo gesto que el botón quitar del Sidebar).
 */
export function archiveWatchlistItem(symbol: string): { archived: boolean } {
  archiveWatchlistItemBySymbol(symbol);
  deleteSymbol(symbol);
  return { archived: true };
}
