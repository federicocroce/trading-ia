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
  // Dynamic scale based on actual values with padding
  const absMax = Math.max(Math.abs(estimate.lowPercent), Math.abs(estimate.highPercent), 5);
  const rangeMin = -absMax - 2;
  const rangeMax = absMax + 2;
  const span = rangeMax - rangeMin;

  const toPos = (val: number) => Math.max(0, Math.min(100, ((val - rangeMin) / span) * 100));

  const lowPos = toPos(estimate.lowPercent);
  const midPos = toPos(estimate.midPercent);
  const highPos = toPos(estimate.highPercent);
  const zeroPos = toPos(0);

  // Color based on mid value
  const midColor = estimate.midPercent > 2 ? 'bg-green-500'
    : estimate.midPercent < -2 ? 'bg-red-500'
    : 'bg-yellow-500';

  // Range bar color
  const rangeColor = estimate.midPercent > 2 ? 'bg-green-500/20'
    : estimate.midPercent < -2 ? 'bg-red-500/20'
    : 'bg-yellow-500/20';

  const confColor = estimate.confidence >= 60 ? 'text-green-500'
    : estimate.confidence >= 45 ? 'text-yellow-500'
    : 'text-muted-foreground';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`text-[9px] font-mono cursor-help ${confColor}`}>{estimate.confidence}% conf.</span>
          </TooltipTrigger>
          <TooltipContent>
            Nivel de confianza: {estimate.confidence >= 60 ? 'Alta — multiples senales alineadas' : estimate.confidence >= 45 ? 'Media — senales parcialmente alineadas' : 'Baja — datos insuficientes o contradictorios'}.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Visual bar */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden cursor-help">
            {/* Range bar from low to high */}
            <div
              className={`absolute top-0 h-full rounded-full ${rangeColor}`}
              style={{ left: `${lowPos}%`, width: `${Math.max(highPos - lowPos, 1)}%` }}
            />
            {/* Zero line */}
            <div
              className="absolute top-0 h-full w-px bg-border/60"
              style={{ left: `${zeroPos}%` }}
            />
            {/* Mid marker (larger, prominent) */}
            <div
              className={`absolute top-0.5 h-2 w-2 rounded-full ${midColor} ring-1 ring-background`}
              style={{ left: `${midPos}%`, transform: 'translateX(-50%)' }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">Rendimiento estimado</p>
            <p>Pesimista: <span className="text-red-400 font-mono">{formatPct(estimate.lowPercent)}</span></p>
            <p>Base: <span className="font-mono font-semibold">{formatPct(estimate.midPercent)}</span></p>
            <p>Optimista: <span className="text-green-400 font-mono">{formatPct(estimate.highPercent)}</span></p>
            {estimate.keyDrivers.length > 0 && (
              <div className="pt-1 border-t border-background/20 space-y-0.5">
                {estimate.keyDrivers.map((d, i) => (
                  <p key={i} className="text-[10px] opacity-80">{d}</p>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Labels: Pesimista / Base / Optimista */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-red-400">{formatPct(estimate.lowPercent)}</span>
        <span className={`text-[10px] font-mono font-semibold ${estimate.midPercent > 2 ? 'text-green-500' : estimate.midPercent < -2 ? 'text-red-500' : 'text-yellow-500'}`}>
          {formatPct(estimate.midPercent)}
        </span>
        <span className="text-[9px] font-mono text-green-400">{formatPct(estimate.highPercent)}</span>
      </div>

      <div className="flex items-center justify-between text-[8px] text-muted-foreground/60">
        <span>Pesimista</span>
        <span>Base</span>
        <span>Optimista</span>
      </div>
    </div>
  );
}
