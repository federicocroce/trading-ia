import { trpc } from '@/shared/trpc';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SymbolLink } from '@/shared/SymbolLink';

const magnitudeStyle = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const magnitudeLabel = { high: 'Alto impacto', medium: 'Medio', low: 'Bajo' };

export function CausalMapView({ date }: { date?: string }) {
  const { data: events = [] } = trpc.intelligence.causalMap.useQuery(
    { date },
    { staleTime: 5 * 60_000 }
  );

  if (events.length === 0) return null;

  return (
    <div className="space-y-3">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Temas del día — {events.length} eventos macro
      </span>
      <div className="space-y-2">
        {events.map((evt) => (
          <Card key={evt.eventId} size="sm" className="border-l-4 border-l-blue-500/60">
            <CardHeader className="pb-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-foreground leading-snug">{evt.event}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className="text-[7px] h-3.5">{evt.category}</Badge>
                  <Badge className={`text-[7px] h-3.5 ${magnitudeStyle[evt.magnitude]}`}>
                    {magnitudeLabel[evt.magnitude]}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            {evt.chains.length > 0 && (
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {evt.chains.map((chain, i) => (
                    <div
                      key={i}
                      title={chain.reason}
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] border cursor-help ${
                        chain.direction === 'positive'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}
                    >
                      <SymbolLink symbol={chain.ticker} className="font-mono font-bold" />
                      <span className="text-[8px] opacity-60">
                        {chain.direction === 'positive' ? '↑' : '↓'}
                        {chain.impact === 'direct' ? '' : ' ~'}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
