import { trpc } from '@/shared/trpc';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const REGIME_CONFIG = {
  bull: {
    label: 'RISK ON',
    className: 'bg-trading-green/20 text-trading-green border-trading-green/30',
    tooltip: 'SPY sobre SMA200, VIX < 20. Condiciones favorables para longs.',
  },
  neutral: {
    label: 'CAUTELA',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    tooltip: 'Régimen mixto. Solo picks de alta convicción.',
  },
  bear: {
    label: 'RIESGO',
    className: 'bg-trading-red/20 text-trading-red border-trading-red/30',
    tooltip: 'SPY bajo SMA200 o VIX > 30. No se generan nuevos picks BUY.',
  },
} as const;

export function MacroRegimeWidget() {
  const { data, isLoading } = trpc.macro.regime.useQuery(undefined, {
    refetchInterval: 60 * 60 * 1000,
  });

  if (isLoading || !data) return null;

  const config = REGIME_CONFIG[data.regime];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-xs font-mono cursor-default ${config.className}`}>
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs max-w-[200px]">{config.tooltip}</p>
        <p className="text-xs text-muted-foreground mt-1">
          SPY ${data.spyPrice} · SMA200 ${data.sma200} · {data.priceVsSma200Pct > 0 ? '+' : ''}{data.priceVsSma200Pct}%
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
