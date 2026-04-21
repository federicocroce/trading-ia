import { trpc } from '@/shared/trpc';

const CATEGORY_CONFIG = {
  LEADING: { label: 'Líder', className: 'text-trading-green bg-trading-green/10 border-trading-green/20' },
  NEUTRAL: { label: 'Neutral', className: 'text-muted-foreground bg-muted/20 border-muted/20' },
  LAGGING: { label: 'Rezagado', className: 'text-trading-red bg-trading-red/10 border-trading-red/20' },
};

export function SectorHeatMap() {
  const { data: sectors, isLoading } = trpc.macro.sectorRotation.useQuery(undefined, {
    refetchInterval: 7 * 24 * 60 * 60 * 1000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Cargando sectores...</div>;
  if (!sectors?.length) return null;

  const sorted = [...sectors].sort((a, b) => b.relativeStrength1m - a.relativeStrength1m);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Rotación de Sectores vs SPY
      </h3>
      <div className="grid grid-cols-1 gap-1">
        {sorted.map((sector) => {
          const config = CATEGORY_CONFIG[sector.category];
          return (
            <div
              key={sector.etf}
              className={`flex items-center justify-between px-3 py-2 rounded border text-sm ${config.className}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{sector.etf}</span>
                <span className="text-xs opacity-70">{sector.sectorName}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span title="RS 1 mes">{sector.relativeStrength1m > 0 ? '+' : ''}{sector.relativeStrength1m.toFixed(1)}%</span>
                <span title="RS 3 meses" className="opacity-70">{sector.relativeStrength3m > 0 ? '+' : ''}{sector.relativeStrength3m.toFixed(1)}%</span>
                <span className="uppercase font-bold text-xs">{config.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
