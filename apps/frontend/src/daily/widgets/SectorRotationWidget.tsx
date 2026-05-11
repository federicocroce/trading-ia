import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const CATEGORY_CONFIG = {
  LEADING: { label: 'Líder', className: 'text-trading-green bg-trading-green/10 border-trading-green/20' },
  NEUTRAL: { label: 'Neutral', className: 'text-muted-foreground bg-muted/20 border-muted/20' },
  LAGGING: { label: 'Rezagado', className: 'text-trading-red bg-trading-red/10 border-trading-red/20' },
};

export function SectorRotationWidget() {
  const { data: sectors, isLoading } = trpc.macro.sectorRotation.useQuery(undefined, {
    refetchInterval: 7 * 24 * 60 * 60 * 1000,
  });

  if (isLoading || !sectors?.length) return null;

  const sorted = [...sectors].sort((a, b) => b.relativeStrength1m - a.relativeStrength1m);

  return (
    <Card size="sm">
      <CardHeader>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Rotación Sectorial (vs SPY)
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {sorted.map((sector) => {
            const config = CATEGORY_CONFIG[sector.category];
            return (
              <div
                key={sector.etf}
                className={`flex items-center justify-between px-2 py-1 rounded border text-[10px] ${config.className}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-semibold">{sector.etf}</span>
                  <span className="opacity-70 truncate">{sector.sectorName}</span>
                </div>
                <div className="flex items-center gap-2 font-mono shrink-0">
                  <span title="RS 1 mes">
                    {sector.relativeStrength1m > 0 ? '+' : ''}{sector.relativeStrength1m.toFixed(1)}%
                  </span>
                  <span className="uppercase font-bold text-[9px]">{config.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
