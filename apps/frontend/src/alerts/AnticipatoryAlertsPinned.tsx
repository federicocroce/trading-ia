import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';

const CATEGORY_LABELS: Record<string, string> = {
  divergence: 'Divergencia alcista',
  golden_cross: 'Golden Cross inminente',
  bb_squeeze: 'BB Squeeze breakout',
  macd_cross: 'Cruce MACD inminente',
  oversold_bounce: 'Rebote sobreventa',
};

export function AnticipatoryAlertsPinned() {
  const { data } = trpc.alerts.list.useQuery(undefined, { staleTime: 60_000 });
  const { goToSymbol } = useNavigation();
  const active = data?.active ?? [];
  if (active.length === 0) return null; // empty state oculto por diseño

  return (
    <Card size="sm" className="border-l-4 border-l-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            ⚡ Alertas Anticipatorias
          </span>
          <Badge className="text-[9px] bg-purple-500/20 text-purple-400">{active.length} setup{active.length > 1 ? 's' : ''}</Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Confluencia de señales que históricamente preceden el movimiento. Son setups probabilísticos, no certezas.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {active.map((a) => (
          <div key={a.id} className={`rounded-md bg-muted/20 border p-2 ${a.kind === 'stop_breach' ? 'border-red-500/30' : 'border-purple-500/20'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs font-bold text-foreground hover:text-purple-400"
                onClick={() => goToSymbol(a.symbol)}
              >
                {a.symbol}
              </button>
              {a.kind === 'stop_breach' ? (
                <Badge className="text-[8px] bg-red-500/20 text-red-400">STOP PERFORADO</Badge>
              ) : (
                <span className="text-[9px] text-muted-foreground">score {Math.round(a.score)}</span>
              )}
              {a.kind === 'anticipatory' && [...new Set(a.signals.map(s => s.category))].map(cat => (
                <Badge key={cat} className="text-[8px] bg-purple-500/15 text-purple-300">
                  {CATEGORY_LABELS[cat] ?? cat}
                </Badge>
              ))}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
              {a.entryPrice != null && <span>Entrada <span className="text-foreground">${a.entryPrice.toFixed(2)}</span></span>}
              {a.stopLoss != null && <span>Stop <span className="text-red-400">${a.stopLoss.toFixed(2)}</span></span>}
              {a.takeProfit != null && <span>Target <span className="text-green-400">${a.takeProfit.toFixed(2)}</span></span>}
              <span className="ml-auto">visto {a.firstSeenDate}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
