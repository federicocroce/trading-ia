import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Newspaper, BarChart2, Zap } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import { getStaleness } from '@/hooks/useDataStaleness';

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: status } = trpc.opportunities.scanStatus.useQuery(undefined, { refetchInterval: 3000 });
  const { data: timestamps } = trpc.opportunities.processTimestamps.useQuery(undefined, { refetchInterval: 5000 });

  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.opportunities.scan.invalidate();
    utils.opportunities.scanStatus.invalidate();
    utils.opportunities.processTimestamps.invalidate();
    utils.opportunities.accuracyStats.invalidate();
    utils.intelligence.dailyReport.invalidate();
    utils.intelligence.sectorReports.invalidate();
  };

  const refreshNews = trpc.opportunities.refreshNews.useMutation({ onSuccess: invalidateAll });
  const refreshFund = trpc.opportunities.refreshFundamentals.useMutation({ onSuccess: invalidateAll });
  const analyze = trpc.opportunities.analyze.useMutation({ onSuccess: invalidateAll });
  const fullPipeline = trpc.opportunities.fullPipeline.useMutation({ onSuccess: invalidateAll });

  const isScanning = status?.isScanning ?? false;
  const anyRunning =
    refreshNews.isPending || refreshFund.isPending ||
    analyze.isPending || fullPipeline.isPending || isScanning;

  const newsS = getStaleness(timestamps?.news ?? null);
  const fundS = getStaleness(timestamps?.fundamentals ?? null);
  const analysisS = getStaleness(timestamps?.analysis ?? null);

  return (
    <header className="bg-card border-b border-border px-4 py-2 shrink-0">
      <div className="flex items-center justify-between gap-4">
        {/* Title */}
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-base font-bold tracking-tight">Trading IA</h1>
          <Badge variant="secondary" className="text-[9px] h-4">ARG & Global</Badge>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="default"
                onClick={() => fullPipeline.mutate()}
                disabled={anyRunning}
                className="h-7 text-xs px-3 font-semibold"
              >
                {isScanning ? 'Analizando...' : 'Analizar'}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium">Análisis completo (~3 min)</p>
              <p className="text-xs">Noticias → Sectores → Fundamentales → Técnico → Scoring → Deep Analysis</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => refreshNews.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${newsS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar noticias"
              >
                {refreshNews.isPending ? <span className="text-[9px]">...</span> : <Newspaper className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Noticias ({newsS.label})</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => refreshFund.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${fundS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar fundamentales"
              >
                {refreshFund.isPending ? <span className="text-[9px]">...</span> : <BarChart2 className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fundamentales ({fundS.label})</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => analyze.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${analysisS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar análisis"
              >
                {analyze.isPending ? <span className="text-[9px]">...</span> : <Zap className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Análisis rápido ({analysisS.label})</TooltipContent>
          </Tooltip>
        </div>

        {/* Portfolio summary */}
        {summary && (
          <div className="flex items-center gap-3 border-l border-border pl-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Portfolio</span>
              <span className="text-sm font-semibold">
                ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </span>
            </div>
            <Badge
              variant={summary.totalPnl >= 0 ? 'default' : 'destructive'}
              className="text-xs h-5"
            >
              {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              {' '}({summary.totalPnlPercent >= 0 ? '+' : ''}{summary.totalPnlPercent.toFixed(1)}%)
            </Badge>
            <span className="text-[10px] text-muted-foreground">{summary.positionCount}p</span>
          </div>
        )}
      </div>
    </header>
  );
}
