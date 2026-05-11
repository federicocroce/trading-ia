import { useMemo } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { useNavigation } from '@/shared/navigation';
import { TICKER_TO_SECTOR } from '@trading/shared';

const MAX_SIGNALS = 5;

export function RadarSummaryWidget() {
  const { goToSymbol } = useNavigation();
  const { data: snapshot } = trpc.news.radarLatest.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });
  const { data: positions } = trpc.portfolio.positions.list.useQuery();

  const portfolioExposure = useMemo(() => {
    if (!snapshot || !positions) return [];
    const portfolioSymbols = new Set(positions.map(p => p.symbol));
    const portfolioSectors = new Set(
      positions.map(p => TICKER_TO_SECTOR[p.symbol.toUpperCase()]).filter(Boolean),
    );
    const negSignals = snapshot.aggregatedSignals.filter(s => s.netScore < 0);
    return negSignals.filter(s =>
      (s.type === 'ticker' && portfolioSymbols.has(s.target)) ||
      (s.type === 'sector' && portfolioSectors.has(s.target)),
    );
  }, [snapshot, positions]);

  if (!snapshot || snapshot.aggregatedSignals.length === 0) return null;

  const positive = [...snapshot.aggregatedSignals]
    .filter(s => s.netScore > 0)
    .sort((a, b) => b.netScore - a.netScore)
    .slice(0, MAX_SIGNALS);

  const negative = [...snapshot.aggregatedSignals]
    .filter(s => s.netScore < 0)
    .sort((a, b) => a.netScore - b.netScore)
    .slice(0, MAX_SIGNALS);

  return (
    <Card size="sm" className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Radar de Noticias
          </span>
          <Badge className="text-[9px] bg-blue-500/20 text-blue-400">
            {snapshot.totalNewsAnalyzed} noticias analizadas
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {portfolioExposure.length > 0 && (
          <div className="rounded bg-red-500/5 border border-red-500/20 p-2">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <p className="text-[10px] font-semibold text-red-400">
                  Tu portfolio expuesto a {portfolioExposure.length} señal(es) negativa(s)
                </p>
                <div className="flex flex-wrap gap-1">
                  {portfolioExposure.slice(0, 6).map((s, i) => (
                    <button
                      key={i}
                      onClick={() => s.type === 'ticker' && goToSymbol(s.target)}
                      className="text-[9px] font-mono text-red-300 hover:text-red-200 underline-offset-2 hover:underline"
                    >
                      −{s.target}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {snapshot.emergingNarratives && snapshot.emergingNarratives.length > 0 && (
          <div>
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">
              Narrativas emergentes
            </span>
            <div className="space-y-0.5 mt-1">
              {snapshot.emergingNarratives.slice(0, 3).map((n, i) => (
                <p key={i} className="text-[10px] text-foreground leading-snug">
                  <span className="text-blue-400 mr-1">•</span>{n}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {positive.length > 0 && (
            <div className="rounded bg-green-500/5 border border-green-500/20 p-2 space-y-1">
              <span className="text-[9px] text-green-400 uppercase tracking-wider font-medium">
                ✅ Top impactos positivos
              </span>
              {positive.map((s, i) => (
                <button
                  key={i}
                  onClick={() => s.type === 'ticker' && goToSymbol(s.target)}
                  className="w-full flex items-center justify-between text-left hover:bg-green-500/10 rounded px-1 py-0.5"
                >
                  <span className="text-[10px] font-mono text-foreground">
                    {s.type === 'ticker' ? s.target : `[${s.target}]`}
                  </span>
                  <span className="text-[9px] font-mono text-green-400">+{s.netScore.toFixed(1)}</span>
                </button>
              ))}
            </div>
          )}
          {negative.length > 0 && (
            <div className="rounded bg-red-500/5 border border-red-500/20 p-2 space-y-1">
              <span className="text-[9px] text-red-400 uppercase tracking-wider font-medium">
                ❌ Top impactos negativos
              </span>
              {negative.map((s, i) => (
                <button
                  key={i}
                  onClick={() => s.type === 'ticker' && goToSymbol(s.target)}
                  className="w-full flex items-center justify-between text-left hover:bg-red-500/10 rounded px-1 py-0.5"
                >
                  <span className="text-[10px] font-mono text-foreground">
                    {s.type === 'ticker' ? s.target : `[${s.target}]`}
                  </span>
                  <span className="text-[9px] font-mono text-red-400">{s.netScore.toFixed(1)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
