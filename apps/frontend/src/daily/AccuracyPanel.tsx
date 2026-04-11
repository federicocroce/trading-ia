import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function winRateColor(rate: number) {
  if (rate >= 60) return 'text-green-400';
  if (rate >= 45) return 'text-yellow-400';
  return 'text-red-400';
}

function returnColor(val: number) {
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-muted-foreground';
}

function DimensionSection() {
  const { data, isLoading } = trpc.opportunities.dimensionCorrelation.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data || data.total === 0) return null;

  const dimensions = [
    { label: 'Tecnico', value: data.techAccuracy, color: 'text-blue-400' },
    { label: 'Fundamental', value: data.fundAccuracy, color: 'text-purple-400' },
    { label: 'Sentimiento', value: data.sentAccuracy, color: 'text-cyan-400' },
  ];

  return (
    <div className="space-y-1.5">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
        Por dimension ({data.total} senales)
      </span>
      <div className="grid grid-cols-3 gap-2">
        {dimensions.map((d) => (
          <Tooltip key={d.label}>
            <TooltipTrigger asChild>
              <div className="text-center cursor-help rounded-md bg-muted/30 py-1.5 px-2">
                <span className="text-[9px] text-muted-foreground block">{d.label}</span>
                <span className={`text-sm font-mono font-bold ${winRateColor(d.value)}`}>
                  {d.value.toFixed(0)}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Accuracy de la dimension {d.label.toLowerCase()}: porcentaje de veces que la senal de esta dimension coincidio con el resultado real.
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function ConfidenceTierSection() {
  const { data, isLoading } = trpc.opportunities.accuracyByConfidenceTier.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data || data.length === 0) return null;

  const tierLabels: Record<string, string> = {
    high: 'Alta (>70%)',
    medium: 'Media (50-70%)',
    low: 'Baja (<50%)',
  };

  const tierBadgeStyle: Record<string, string> = {
    high: 'bg-green-500/20 text-green-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    low: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
        Por nivel de confianza
      </span>
      <div className="space-y-1">
        {data.map((t) => (
          <div key={t.tier} className="flex items-center justify-between py-1 px-2 rounded bg-muted/20">
            <div className="flex items-center gap-2">
              <Badge className={`text-[8px] h-4 ${tierBadgeStyle[t.tier] ?? 'bg-muted text-muted-foreground'}`}>
                {tierLabels[t.tier] ?? t.tier}
              </Badge>
              <span className="text-[9px] text-muted-foreground">{t.total} senales</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-mono font-semibold ${winRateColor(t.winRate)}`}>
                {t.winRate.toFixed(0)}% win
              </span>
              {t.avgReturn7d != null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`text-[9px] font-mono cursor-help ${returnColor(t.avgReturn7d)}`}>
                      {t.avgReturn7d > 0 ? '+' : ''}{t.avgReturn7d.toFixed(1)}%
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Retorno promedio a 7 dias para senales con confianza {tierLabels[t.tier] ?? t.tier}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectorAccuracySection() {
  const { data, isLoading } = trpc.opportunities.accuracyBySector.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data || data.length === 0) return null;

  // Show top 3 sectors by total signals
  const top = [...data].sort((a, b) => b.total - a.total).slice(0, 3);

  return (
    <div className="space-y-1.5">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
        Por sector (top {top.length})
      </span>
      <div className="space-y-1">
        {top.map((s) => (
          <div key={s.sector} className="flex items-center justify-between py-1 px-2 rounded bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium">{s.sector}</span>
              <span className="text-[9px] text-muted-foreground">{s.total} senales</span>
            </div>
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 cursor-help">
                    <span className="text-[9px] text-green-400">{s.wins}W</span>
                    <span className="text-[9px] text-muted-foreground">/</span>
                    <span className="text-[9px] text-red-400">{s.losses}L</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{s.wins} ganadas, {s.losses} perdidas en {s.sector}</TooltipContent>
              </Tooltip>
              <span className={`text-[11px] font-mono font-semibold ${winRateColor(s.winRate)}`}>
                {s.winRate.toFixed(0)}%
              </span>
              {s.avgReturn7d != null && (
                <span className={`text-[9px] font-mono ${returnColor(s.avgReturn7d)}`}>
                  {s.avgReturn7d > 0 ? '+' : ''}{s.avgReturn7d.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EstimateAccuracySection() {
  const { data, isLoading } = trpc.opportunities.estimateAccuracy.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data || data.total === 0) return null;

  const biasDirection = data.avgBias > 0 ? 'sobrestimamos' : data.avgBias < 0 ? 'subestimamos' : 'neutral';

  return (
    <div className="space-y-1.5">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
        Precision de estimaciones ({data.total} senales)
      </span>
      <div className="grid grid-cols-2 gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-center cursor-help rounded-md bg-muted/30 py-1.5 px-2">
              <span className="text-[9px] text-muted-foreground block">Bias promedio</span>
              <span className={`text-sm font-mono font-semibold ${returnColor(data.avgBias)}`}>
                {data.avgBias > 0 ? '+' : ''}{data.avgBias.toFixed(1)}%
              </span>
              <span className="text-[8px] text-muted-foreground block">({biasDirection})</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Diferencia promedio entre el retorno estimado y el real. Positivo = sobrestimamos retornos, negativo = subestimamos.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-center cursor-help rounded-md bg-muted/30 py-1.5 px-2">
              <span className="text-[9px] text-muted-foreground block">Error absoluto</span>
              <span className={`text-sm font-mono font-semibold ${data.avgAbsError <= 3 ? 'text-green-400' : data.avgAbsError <= 6 ? 'text-yellow-400' : 'text-red-400'}`}>
                +/-{data.avgAbsError.toFixed(1)}%
              </span>
              <span className="text-[8px] text-muted-foreground block">desviacion prom.</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Error absoluto promedio: cuanto se desvian nuestras estimaciones del resultado real, sin importar la direccion.
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function AccuracyPanel() {
  // Use dimensionCorrelation as the "main" query to determine if we have any data at all
  const { data: dimData, isLoading: dimLoading } = trpc.opportunities.dimensionCorrelation.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const hasData = dimData && dimData.total > 0;
  const isLoading = dimLoading;

  if (isLoading) return null;

  if (!hasData) {
    return (
      <Card size="sm">
        <CardHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accuracy del sistema</span>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Todavia no hay suficientes senales resueltas para medir accuracy.
            Las senales BUY/SELL se evaluan automaticamente a los 7 y 30 dias.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accuracy del sistema</span>
          <Badge className="text-[8px] bg-muted text-muted-foreground">{dimData.total} senales resueltas</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DimensionSection />
        <ConfidenceTierSection />
        <SectorAccuracySection />
        <EstimateAccuracySection />
      </CardContent>
    </Card>
  );
}
