import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNavigation } from '@/shared/navigation';

const HOUR_LABEL: Record<string, string> = {
  bmo: 'pre-apertura',
  amc: 'post-cierre',
  dmh: 'durante sesión',
};

export function EarningsWidget() {
  const { goToSymbol } = useNavigation();
  const { data: earnings, isLoading } = trpc.intelligence.earningsCalendar.useQuery(
    { daysAhead: 7 },
    { staleTime: 30 * 60_000 },
  );

  if (isLoading || !earnings?.length) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Earnings esta semana
          </span>
          <Badge className="text-[9px] bg-amber-500/20 text-amber-400">
            {earnings.length} reportes
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {earnings.slice(0, 10).map((e) => {
          const when = e.daysUntil === 0 ? 'HOY' : e.daysUntil === 1 ? 'MAÑANA' : `+${e.daysUntil}d`;
          const timing = HOUR_LABEL[e.hour] ?? e.hour;
          const isImminent = e.daysUntil <= 1;
          return (
            <button
              key={e.symbol + e.date}
              onClick={() => goToSymbol(e.symbol)}
              className="w-full flex items-center justify-between text-left hover:bg-muted/30 rounded px-2 py-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-mono font-semibold">{e.symbol}</span>
                <span className={`text-[9px] px-1 rounded ${isImminent ? 'bg-amber-500/20 text-amber-400' : 'bg-muted/50 text-muted-foreground'}`}>
                  {when}
                </span>
                <span className="text-[9px] text-muted-foreground">{timing}</span>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono">
                {e.epsEstimate != null && (
                  <span className="text-muted-foreground">EPS est: ${e.epsEstimate.toFixed(2)}</span>
                )}
                {e.consensus && (
                  <span className="text-muted-foreground">
                    <span className="text-green-400">{e.consensus.buy}↑</span>{' '}
                    <span>{e.consensus.hold}=</span>{' '}
                    <span className="text-red-400">{e.consensus.sell}↓</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
