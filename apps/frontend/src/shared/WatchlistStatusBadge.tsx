import type { WatchlistStatusItem, WatchlistStatus } from './useWatchlistStatus';

const STATUS_META: Record<WatchlistStatus, { icon: string; label: string; cls: string }> = {
  live:        { icon: '🟢', label: 'VIVA',       cls: 'text-trading-green border-trading-green/40 bg-trading-green/10' },
  triggered:   { icon: '🎯', label: 'GATILLADA',  cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  invalidated: { icon: '❌', label: 'INVALIDADA', cls: 'text-trading-red border-trading-red/40 bg-trading-red/10' },
  expired:     { icon: '⏳', label: 'EXPIRADA',   cls: 'text-muted-foreground border-border bg-muted/40' },
  archived:    { icon: '📦', label: 'ARCHIVADA',  cls: 'text-muted-foreground border-border bg-muted/40' },
};

/** Badge compacto con el estado del ciclo de vida del watchlist + retorno. */
export function WatchlistStatusBadge({
  item,
  showReturn = true,
}: {
  item: WatchlistStatusItem;
  showReturn?: boolean;
}) {
  const meta = STATUS_META[item.status];
  if (!meta) return null;

  const ret = item.status === 'live' ? item.lastReturn : item.resolutionReturn;
  const title = item.thesis
    ? item.thesis
    : `Alta ${item.addedAt} @ $${item.entryPrice.toFixed(2)} (${item.entryAction})`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded border ${meta.cls}`}
      title={title}
    >
      <span>{meta.icon}</span>
      <span className="font-semibold">{meta.label}</span>
      {showReturn && ret != null && (
        <span className="font-mono">{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</span>
      )}
    </span>
  );
}
