import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SectorImpactMapEntry } from '@trading/shared';
import { SymbolLink } from '@/shared/SymbolLink';

const impactColor: Record<string, string> = {
  positive: 'border-l-trading-green/60',
  negative: 'border-l-trading-red/60',
  mixed: 'border-l-amber-500/60',
  neutral: 'border-l-muted',
};
const impactBadge: Record<string, string> = {
  positive: 'bg-trading-green/15 text-trading-green',
  negative: 'bg-trading-red/15 text-trading-red',
  mixed: 'bg-amber-500/15 text-amber-400',
  neutral: 'bg-muted text-muted-foreground',
};
const impactLabel: Record<string, string> = {
  positive: 'Viento a favor', negative: 'Viento en contra', mixed: 'Mixto', neutral: 'Neutral',
};

function TickerChip({ symbol, inPortfolio, tone }: { symbol: string; inPortfolio: boolean; tone: 'win' | 'lose' }) {
  const base = tone === 'win'
    ? 'bg-trading-green/10 text-trading-green'
    : 'bg-trading-red/10 text-trading-red';
  return (
    <SymbolLink
      symbol={symbol}
      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${base} ${inPortfolio ? 'ring-1 ring-amber-400/70' : ''}`}
    >
      {inPortfolio && '★'}{symbol}
    </SymbolLink>
  );
}

function SectorCard({ s }: { s: SectorImpactMapEntry }) {
  return (
    <Card size="sm" className={`border-l-4 ${impactColor[s.netImpact] ?? 'border-l-muted'}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold">{s.label}</span>
          <div className="flex items-center gap-1">
            <Badge className={`text-[8px] ${impactBadge[s.netImpact] ?? ''}`}>{impactLabel[s.netImpact] ?? s.netImpact}</Badge>
            <Badge variant="outline" className="text-[8px]">conf. {s.confidence}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {s.drivers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.drivers.map((d, i) => (
              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded ${d.direction === 'positive' ? 'bg-trading-green/10 text-trading-green' : 'bg-trading-red/10 text-trading-red'}`}>
                {d.direction === 'positive' ? '↑' : '↓'} {d.event.length > 60 ? d.event.slice(0, 60) + '…' : d.event} ({d.magnitude})
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-trading-green/80 mb-1">Favor</p>
            <div className="flex flex-wrap gap-1">
              {s.winners.length === 0 ? <span className="text-[10px] text-muted-foreground italic">—</span>
                : s.winners.map(w => <TickerChip key={w.symbol} symbol={w.symbol} inPortfolio={w.inPortfolio} tone="win" />)}
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-trading-red/80 mb-1">En contra</p>
            <div className="flex flex-wrap gap-1">
              {s.losers.length === 0 ? <span className="text-[10px] text-muted-foreground italic">—</span>
                : s.losers.map(l => <TickerChip key={l.symbol} symbol={l.symbol} inPortfolio={l.inPortfolio} tone="lose" />)}
            </div>
          </div>
        </div>
        {s.yourHoldings.length > 0 && (
          <p className="text-[10px] text-amber-400/90">
            ★ Tus posiciones acá: {s.yourHoldings.map(h => `${h.symbol}${h.side !== 'neutral' ? ` (${h.side === 'winner' ? 'favor' : 'contra'})` : ''}`).join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SectorImpactMapPanel() {
  const { data, isLoading } = trpc.intelligence.sectorImpactMap.useQuery(undefined, { staleTime: 10 * 60_000 });
  if (isLoading || !data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Mapa macro → sectores (impacto en tus posiciones)
        </span>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          Qué perilla macro mueve cada sector, con qué confianza, y qué tickers quedan a favor vs en contra. ★ = lo que ya tenés.
          Es <strong>contexto condicional</strong>, no una predicción ni una señal de trading. (Distinto del panel de sentimiento de noticias.)
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.map((s) => <SectorCard key={s.sector} s={s} />)}
        </div>
      </CardContent>
    </Card>
  );
}
