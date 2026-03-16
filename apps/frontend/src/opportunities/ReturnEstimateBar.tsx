import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ReturnEstimate {
  lowPercent: number;
  midPercent: number;
  highPercent: number;
  confidence: number;
  keyDrivers: string[];
}

function formatPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`;
}

export function ReturnEstimateBar({ estimate, label }: { estimate: ReturnEstimate; label: string }) {
  // Scale: show range from min(low, -10) to max(high, 30)
  const rangeMin = Math.min(estimate.lowPercent, -10);
  const rangeMax = Math.max(estimate.highPercent, 30);
  const span = rangeMax - rangeMin;

  const lowPos = ((estimate.lowPercent - rangeMin) / span) * 100;
  const midPos = ((estimate.midPercent - rangeMin) / span) * 100;
  const highPos = ((estimate.highPercent - rangeMin) / span) * 100;
  const zeroPos = ((0 - rangeMin) / span) * 100;

  const midColor = estimate.midPercent > 0 ? 'bg-green-500' : estimate.midPercent < 0 ? 'bg-red-500' : 'bg-gray-400';
  const confColor = estimate.confidence >= 60 ? 'text-green-500' : estimate.confidence >= 45 ? 'text-yellow-500' : 'text-muted-foreground';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`text-[9px] font-mono cursor-help ${confColor}`}>{estimate.confidence}% conf.</span>
          </TooltipTrigger>
          <TooltipContent>
            Nivel de confianza en la estimacion. {estimate.confidence >= 60 ? 'Alta' : estimate.confidence >= 45 ? 'Media' : 'Baja'} — basado en cantidad y calidad de datos disponibles.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Visual bar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden cursor-help">
            {/* Range bar from low to high */}
            <div
              className="absolute top-0 h-full bg-muted-foreground/20 rounded-full"
              style={{ left: `${lowPos}%`, width: `${highPos - lowPos}%` }}
            />
            {/* Zero line */}
            <div
              className="absolute top-0 h-full w-px bg-border"
              style={{ left: `${zeroPos}%` }}
            />
            {/* Mid marker */}
            <div
              className={`absolute top-0 h-full w-1 rounded-full ${midColor}`}
              style={{ left: `${midPos}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">Rendimiento estimado</p>
            <p>Pesimista: {formatPct(estimate.lowPercent)}</p>
            <p>Base (mas probable): {formatPct(estimate.midPercent)}</p>
            <p>Optimista: {formatPct(estimate.highPercent)}</p>
            {estimate.keyDrivers.length > 0 && (
              <p className="text-[10px] opacity-80 pt-1 border-t border-background/20">
                Drivers: {estimate.keyDrivers.join(', ')}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Labels below bar: Pesimista / Base / Optimista */}
      <div className="flex items-center justify-between">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[9px] font-mono text-red-400 cursor-help">{formatPct(estimate.lowPercent)}</span>
          </TooltipTrigger>
          <TooltipContent>Escenario pesimista</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`text-[10px] font-mono font-semibold cursor-help ${estimate.midPercent > 0 ? 'text-green-500' : estimate.midPercent < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
              {formatPct(estimate.midPercent)}
            </span>
          </TooltipTrigger>
          <TooltipContent>Escenario base (mas probable)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[9px] font-mono text-green-400 cursor-help">{formatPct(estimate.highPercent)}</span>
          </TooltipTrigger>
          <TooltipContent>Escenario optimista</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center justify-between text-[8px] text-muted-foreground/60">
        <span>Pesimista</span>
        <span>Base</span>
        <span>Optimista</span>
      </div>
    </div>
  );
}
