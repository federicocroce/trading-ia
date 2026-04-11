import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';

function timeAgo(ts: number | null): string {
  if (!ts) return 'nunca';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function ScanProgressBar() {
  const { data: status } = trpc.opportunities.scanStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  if (!status?.isScanning) return null;

  const elapsed = status.elapsedSeconds ?? 0;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-md px-3 py-1.5 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-blue-400 font-medium">
          {status.currentStep} ({status.stepNumber}/{status.totalSteps})
        </span>
        <span className="text-muted-foreground">{min}:{sec.toString().padStart(2, '0')}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-blue-500 transition-all duration-1000" style={{ width: `${status.percentComplete}%` }} />
      </div>
    </div>
  );
}

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: scan } = trpc.opportunities.scan.useQuery(undefined, { staleTime: 5 * 60_000 });
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
  const anyRunning = refreshNews.isPending || refreshFund.isPending || analyze.isPending || fullPipeline.isPending || isScanning;

  const lastScan = scan?.scannedAt && scan.opportunities.length > 0
    ? new Date(scan.scannedAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : null;

  return (
    <header className="bg-card border-b border-border px-6 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Trading Dashboard</h1>
          <Badge variant="secondary">Argentina & Global</Badge>
        </div>

        <div className="flex items-center gap-4">
          {/* Botón principal + opciones avanzadas */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm" variant="default"
                  onClick={() => fullPipeline.mutate()}
                  disabled={anyRunning}
                  className="h-8 text-xs px-4 font-semibold"
                >
                  {isScanning ? 'Procesando...' : 'Analizar'}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-medium">Analisis completo (~3 min)</p>
                <p>Noticias → Sectores (DeepSeek R1) → Fundamentales (si hace falta) → Tecnico → Scoring → Deep Analysis</p>
              </TooltipContent>
            </Tooltip>

            {/* Opciones individuales (colapsadas) */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" onClick={() => refreshNews.mutate()} disabled={anyRunning} className="h-6 text-[9px] px-1.5 text-muted-foreground" aria-label="Actualizar noticias">
                    {refreshNews.isPending ? '...' : 'N'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Solo noticias (~30s). Ultima: {timeAgo(timestamps?.news ?? null)}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" onClick={() => refreshFund.mutate()} disabled={anyRunning} className="h-6 text-[9px] px-1.5 text-muted-foreground" aria-label="Actualizar fundamentales">
                    {refreshFund.isPending ? '...' : 'F'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Solo fundamentales (~60s). Ultima: {timeAgo(timestamps?.fundamentals ?? null)}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost" onClick={() => analyze.mutate()} disabled={anyRunning} className="h-6 text-[9px] px-1.5 text-muted-foreground" aria-label="Actualizar analisis">
                    {analyze.isPending ? '...' : 'A'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Solo analisis rapido (~15s, usa BD). Ultima: {timeAgo(timestamps?.analysis ?? null)}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Timestamps */}
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground border-l border-border pl-3">
            <span>N: {timeAgo(timestamps?.news ?? null)}</span>
            <span>F: {timeAgo(timestamps?.fundamentals ?? null)}</span>
            {lastScan && <span>A: {lastScan}</span>}
          </div>

          {/* Portfolio summary */}
          {summary && (
            <div className="flex items-center gap-4 text-sm border-l border-border pl-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Portfolio</span>
                <span className="font-semibold">
                  ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">P&L</span>
                <Badge variant={summary.totalPnl >= 0 ? 'default' : 'destructive'}>
                  {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  {' '}({summary.totalPnlPercent >= 0 ? '+' : ''}{summary.totalPnlPercent.toFixed(1)}%)
                </Badge>
              </div>
              <span className="text-muted-foreground text-xs">{summary.positionCount} posiciones</span>
            </div>
          )}
        </div>
      </div>

      <ScanProgressBar />
    </header>
  );
}
