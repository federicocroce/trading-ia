import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { WeeklyPick } from '@trading/shared';

const TIER_CONFIG = {
  HIGH: { label: 'ALTA CONVICCIÓN', className: 'bg-trading-green/20 text-trading-green border-trading-green/30' },
  MEDIUM: { label: 'MEDIA', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

const EVIDENCE_LABELS: Record<WeeklyPick['evidence']['type'], string> = {
  PEAD: 'Post-Earnings Drift',
  INSIDER: 'Compra Insider',
  OPTIONS: 'Flujo de Opciones',
  PEAD_INSIDER: 'PEAD + Insider',
  FUNDAMENTAL: 'Fundamentals',
};

const SECTOR_CONFIG = {
  LEADING: { label: 'Sector líder', className: 'text-trading-green' },
  NEUTRAL: { label: 'Sector neutral', className: 'text-muted-foreground' },
  LAGGING: { label: 'Sector rezagado', className: 'text-trading-red' },
};

interface PickCardProps {
  pick: WeeklyPick;
}

export function PickCard({ pick }: PickCardProps) {
  const tier = TIER_CONFIG[pick.tier];
  const sector = SECTOR_CONFIG[pick.sectorCategory];

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg">{pick.symbol}</span>
          <Badge variant="outline" className={`text-xs ${tier.className}`}>
            {tier.label}
          </Badge>
        </div>
        <span className={`text-xs ${sector.className}`}>{sector.label}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {EVIDENCE_LABELS[pick.evidence.type]}
          </span>
          <p className="text-foreground mt-0.5">{pick.evidence.detail}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-background/50 rounded p-2">
            <p className="text-xs text-muted-foreground">Entrada</p>
            <p className="text-sm font-mono">${pick.entryLow.toFixed(2)}–${pick.entryHigh.toFixed(2)}</p>
          </div>
          <div className="bg-trading-red/10 rounded p-2">
            <p className="text-xs text-muted-foreground">Stop</p>
            <p className="text-sm font-mono text-trading-red">${pick.stop.toFixed(2)}</p>
          </div>
          <div className="bg-trading-green/10 rounded p-2">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-sm font-mono text-trading-green">${pick.target.toFixed(2)}</p>
          </div>
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>R/R <span className="text-foreground font-mono">{pick.rrRatio.toFixed(1)}x</span></span>
          <span>Fund. <span className="text-foreground font-mono">{pick.fundamentalScore}</span></span>
          <span>Tec. <span className="text-foreground font-mono">{pick.technicalScore}</span></span>
          {pick.aiVerdict && (
            <span>IA <span className={`font-mono ${pick.aiVerdict === 'BUY_SETUP' ? 'text-trading-green' : 'text-yellow-400'}`}>{pick.aiVerdict}</span></span>
          )}
        </div>

        {pick.historicalWinRate !== null && (
          <p className="text-xs text-muted-foreground">
            Win rate histórico ({EVIDENCE_LABELS[pick.evidence.type]}): <span className="text-foreground">{(pick.historicalWinRate * 100).toFixed(0)}%</span>
          </p>
        )}
        {pick.historicalWinRate === null && (
          <p className="text-xs text-muted-foreground">Sin datos suficientes para win rate histórico</p>
        )}
      </CardContent>
    </Card>
  );
}
