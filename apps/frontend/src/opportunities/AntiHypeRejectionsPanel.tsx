import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigation } from '@/shared/navigation';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function AntiHypeRejectionsPanel() {
  const [search, setSearch] = useState('');
  const { goToSymbol } = useNavigation();
  const { data: rejections, isLoading } = trpc.opportunities.antiHypeRejectionsRecent.useQuery(
    { limit: 200 },
    { refetchInterval: 5 * 60_000 },
  );

  const filtered = (rejections ?? []).filter(r =>
    !search || r.symbol.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by symbol → most recent rejection per symbol
  const bySymbol = new Map<string, typeof filtered[0]>();
  for (const r of filtered) {
    const prev = bySymbol.get(r.symbol);
    if (!prev || new Date(r.rejectedAt) > new Date(prev.rejectedAt)) {
      bySymbol.set(r.symbol, r);
    }
  }
  const uniqueRecent = [...bySymbol.values()].sort((a, b) =>
    new Date(b.rejectedAt).getTime() - new Date(a.rejectedAt).getTime(),
  );

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Cargando rechazados...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Anti-hype rejections (últimas {filtered.length} de {rejections?.length ?? 0})
            </span>
            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
              Tickers que NO entraron al scoring por filtros técnicos. Útil para entender por qué algo no aparece.
            </p>
          </div>
          <Input
            placeholder="Buscar ticker..."
            value={search}
            onChange={e => setSearch(e.target.value.toUpperCase())}
            className="h-7 text-xs max-w-32"
          />
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-3">
          {uniqueRecent.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sin rechazos recientes</p>
          ) : (
            <div className="space-y-1.5">
              {uniqueRecent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 text-xs border-l-2 border-trading-red/40 pl-2 py-1 hover:bg-muted/30 rounded-r"
                >
                  <button
                    type="button"
                    onClick={() => goToSymbol(r.symbol)}
                    className="font-mono font-semibold shrink-0 hover:text-blue-400 w-16 text-left"
                  >
                    {r.symbol}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                      {r.reasons.map((reason, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-[9px] bg-trading-red/10 text-trading-red border-trading-red/30"
                        >
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <span className="text-[9px] text-muted-foreground shrink-0">{formatRelative(r.rejectedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
