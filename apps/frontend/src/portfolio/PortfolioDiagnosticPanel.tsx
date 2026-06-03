import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNavigation } from '@/shared/navigation';

function pct(weight: number): number {
  return Math.round(weight * 100);
}

export function PortfolioDiagnosticPanel() {
  const { goToSymbol } = useNavigation();
  const { data, isLoading } = trpc.opportunities.portfolioDiagnostic.useQuery(undefined, {
    refetchInterval: 10 * 60_000,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Analizando correlación de cartera...</div>;
  }
  if (!data || data.factorExposure.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Diagnóstico de cartera — correlación de riesgo
        </span>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          Cómo se concentra tu riesgo por factor, qué cobertura te falta, y qué candidatos diversifican vs apilan lo que ya tenés.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Concentración por factor */}
        <div className="space-y-1.5">
          {data.factorExposure.map((f) => (
            <div key={f.factor} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 font-mono">{f.factor}</span>
              <div className="flex-1 h-2 bg-muted/40 rounded overflow-hidden">
                <div
                  className={`h-full ${f.weight >= 0.3 ? 'bg-trading-red/70' : 'bg-blue-400/60'}`}
                  style={{ width: `${Math.min(100, pct(f.weight))}%` }}
                />
              </div>
              <span className="w-10 text-right tabular-nums">{pct(f.weight)}%</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">{f.symbols.join(', ')}</span>
            </div>
          ))}
        </div>

        {/* Flags de concentración */}
        {data.concentrationFlags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.concentrationFlags.map((c, i) => (
              <Badge key={i} variant="outline" className="text-[9px] bg-trading-red/10 text-trading-red border-trading-red/30">
                ⚠️ {c}
              </Badge>
            ))}
          </div>
        )}

        {/* Hedge faltante */}
        {data.missingHedges.length > 0 && (
          <div className="text-xs space-y-1 border-l-2 border-amber-500/40 pl-2">
            <p className="font-medium text-amber-500/90">Cobertura que te falta</p>
            {data.missingHedges.map((h, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                <span className="font-mono uppercase">{h.hedge}</span> — {h.reason}
                {h.candidates.length > 0 && <> → <span className="text-blue-400">{h.candidates.join(', ')}</span></>}
              </p>
            ))}
          </div>
        )}

        {/* Diversifican vs apilan */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-trading-green/80 mb-1">Diversifican</p>
            <div className="flex flex-wrap gap-1">
              {data.diversifiers.length === 0 ? <span className="text-muted-foreground italic">—</span> :
                [...new Set(data.diversifiers)].map((s) => (
                  <button key={s} type="button" onClick={() => goToSymbol(s)}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-trading-green/10 text-trading-green hover:bg-trading-green/20">
                    {s}
                  </button>
                ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-trading-red/80 mb-1">Apilan tu riesgo</p>
            <div className="flex flex-wrap gap-1">
              {data.stackers.length === 0 ? <span className="text-muted-foreground italic">—</span> :
                [...new Set(data.stackers)].map((s) => (
                  <button key={s} type="button" onClick={() => goToSymbol(s)}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-trading-red/10 text-trading-red hover:bg-trading-red/20">
                    {s}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
