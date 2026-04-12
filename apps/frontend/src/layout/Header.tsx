import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { usePipeline } from '@/pipeline/usePipeline';

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { run, isRunning, todayRun } = usePipeline();

  function getAnalyzeLabel(): string {
    if (!isRunning) return 'Analizar';
    const stages = todayRun?.stages;
    if (!stages) return 'Ejecutando...';
    if (stages.news.status === 'running') return 'Obteniendo noticias...';
    if (stages.fundamentals?.status === 'running') return 'Fundamentales...';
    if (stages.analysis.status === 'running') return 'Analizando...';
    if (stages.report.status === 'running') return 'Generando reporte...';
    return 'Ejecutando...';
  }

  return (
    <header className="bg-card border-b border-border px-4 py-2 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-base font-bold tracking-tight">Trading IA</h1>
          <Badge variant="secondary" className="text-[9px] h-4">ARG & Global</Badge>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="default"
                onClick={() => run(false)}
                disabled={isRunning}
                className="h-7 text-xs px-3 font-semibold"
              >
                {getAnalyzeLabel()}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium">Pipeline completo (~3-5 min)</p>
              <p className="text-xs">Noticias → Fundamentales → Análisis → Reporte</p>
            </TooltipContent>
          </Tooltip>
        </div>

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
