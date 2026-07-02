import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Settings } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import { usePipeline } from '@/pipeline/usePipeline';
import { MacroRegimeWidget } from '@/macro/MacroRegimeWidget';
import { useAiModeModal } from '@/shared/AiModeModal';
import { PipelineConfig } from '@/intelligence/PipelineConfig';
import { getMarketStatus } from '@/shared/marketStatus';

function MarketStatusBadge() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const market = getMarketStatus(now);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-[9px] h-4 gap-1 cursor-help ${
            market.open
              ? 'border-green-500/40 text-green-400'
              : 'border-muted-foreground/30 text-muted-foreground'
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${market.open ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
          {market.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{market.detail}</TooltipContent>
    </Tooltip>
  );
}

const SECTOR_PRESETS: { label: string; value: string; sectors: string[] | undefined }[] = [
  { label: 'Todos', value: 'all', sectors: undefined },
  { label: 'Acciones', value: 'acciones', sectors: ['argentina-energy', 'argentina-finance', 'argentina-cedears', 'us-tech', 'us-energy', 'emerging-markets'] },
  { label: 'ETFs', value: 'etfs', sectors: ['etfs-sectors'] },
  { label: 'Crypto', value: 'crypto', sectors: ['crypto'] },
  { label: 'Bonos', value: 'bonos', sectors: ['bonds'] },
  { label: 'Commodities', value: 'commodities', sectors: ['commodities'] },
];

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { run, isRunning, todayRun } = usePipeline();
  const [presetKey, setPresetKey] = useState('all');
  const { selectMode, modal } = useAiModeModal();

  const selectedPreset = SECTOR_PRESETS.find((p) => p.value === presetKey) ?? SECTOR_PRESETS[0];

  function getAnalyzeLabel(): string {
    if (!isRunning) return 'Ejecutar pipeline';
    const stages = todayRun?.stages;
    if (!stages) return 'Ejecutando...';
    if (stages.news.status === 'running') return 'Noticias...';
    if (stages.fundamentals?.status === 'running') return 'Fundamentales...';
    if (stages.analysis.status === 'running') return 'Análisis...';
    if (stages.report.status === 'running') return 'Reporte...';
    return 'Ejecutando...';
  }

  return (
    <>
    <header className="bg-card border-b border-border px-4 py-2 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-base font-bold tracking-tight">Trading IA</h1>
          <Badge variant="secondary" className="text-[9px] h-4">ARG & Global</Badge>
          <MarketStatusBadge />
        </div>

        <div className="flex items-center gap-2">
          <Select value={presetKey} onValueChange={setPresetKey} disabled={isRunning}>
            <SelectTrigger className="h-7 text-xs w-32 border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTOR_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="default"
                onClick={async () => {
                  const mode = await selectMode();
                  if (!mode) return;
                  run(true, selectedPreset.sectors, mode);
                }}
                disabled={isRunning}
                className="h-7 text-xs px-3 font-semibold"
              >
                {getAnalyzeLabel()}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium">Pipeline completo (~3-5 min)</p>
              <p className="text-xs">Noticias → Fundamentales → Análisis → Reporte</p>
              {selectedPreset.sectors && (
                <p className="text-xs text-muted-foreground mt-1">
                  Scope: {selectedPreset.label}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
          <MacroRegimeWidget />

          <Sheet>
            <Tooltip>
              <TooltipTrigger asChild>
                <SheetTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-label="Configuración"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
              </TooltipTrigger>
              <TooltipContent>Configuración del pipeline</TooltipContent>
            </Tooltip>
            <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Configuración</SheetTitle>
              </SheetHeader>
              <PipelineConfig />
            </SheetContent>
          </Sheet>
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
    {modal}
    </>
  );
}
