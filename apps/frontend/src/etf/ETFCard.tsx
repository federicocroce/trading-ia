import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';
import { useNavigation } from '@/shared/navigation';

interface EnrichedEtf {
  id: number;
  symbol: string;
  name: string;
  category: string;
  description: string | null;
  price: number | null;
  changePercent: number | null;
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH' | null;
  opportunityScore: number | null;
  confidence: number | null;
  rsi: number | null;
  thesis: string | null;
  narrative: string | null;
  analyzedAt: number | null;
}

interface ETFCardProps {
  etf: EnrichedEtf;
  onRemove?: (symbol: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  indices: 'Índices',
  sectores: 'Sectores',
  bonos: 'Bonos',
  commodities: 'Commodities',
  latam: 'Latam',
  internacional: 'Internacional',
  crypto: 'Crypto',
  factor: 'Factor',
};

const ACTION_STYLES: Record<NonNullable<EnrichedEtf['action']>, string> = {
  BUY: 'bg-trading-green/20 text-trading-green border-trading-green/40',
  SELL: 'bg-trading-red/20 text-trading-red border-trading-red/40',
  HOLD: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  WATCH: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
};

function rsiLabel(rsi: number): { text: string; color: string } {
  if (rsi <= 30) return { text: 'Sobrev', color: 'text-trading-green' };
  if (rsi >= 70) return { text: 'Sobrecomp', color: 'text-trading-red' };
  return { text: 'Neutral', color: 'text-muted-foreground' };
}

export function ETFCard({ etf, onRemove }: ETFCardProps) {
  const { goToSymbol } = useNavigation();
  const change = etf.changePercent;
  const changeColor = change == null ? 'text-muted-foreground' : change >= 0 ? 'text-trading-green' : 'text-trading-red';
  const rsi = etf.rsi;
  const rsiInfo = rsi != null ? rsiLabel(rsi) : null;

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    goToSymbol(etf.symbol);
  };

  return (
    <Card
      className="bg-card border-border hover:border-blue-500/40 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      <CardContent className="p-3 flex flex-col gap-2">
        {/* Header: symbol + category + remove button */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-bold text-sm text-white">{etf.symbol}</span>
            <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 shrink-0">
              {CATEGORY_LABELS[etf.category] ?? etf.category}
            </Badge>
            {etf.action && (
              <Badge variant="outline" className={`text-[10px] shrink-0 ${ACTION_STYLES[etf.action]}`}>
                {etf.action}
              </Badge>
            )}
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => onRemove(etf.symbol)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Name */}
        <p className="text-xs text-muted-foreground leading-tight line-clamp-1">{etf.name}</p>

        {/* Live data row: price + change + score + RSI */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Precio</span>
            <span className="font-mono font-semibold">
              {etf.price != null ? `$${etf.price.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Cambio</span>
            <span className={`font-mono font-semibold ${changeColor}`}>
              {change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Score</span>
            <span className="font-mono font-semibold">
              {etf.opportunityScore != null ? `${etf.opportunityScore}/100` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">RSI</span>
            <span className={`font-mono font-semibold ${rsiInfo?.color ?? 'text-muted-foreground'}`}>
              {rsi != null ? `${rsi.toFixed(0)}` : '—'}
              {rsiInfo && <span className="ml-1 text-[9px]">{rsiInfo.text}</span>}
            </span>
          </div>
        </div>

        {/* Thesis (if analyzed) */}
        {etf.thesis && (
          <p className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-2 pt-1 border-t border-border/40">
            {etf.thesis}
          </p>
        )}

        {/* Description fallback if no thesis */}
        {!etf.thesis && etf.description && (
          <p className="text-[10px] text-muted-foreground/70 leading-snug line-clamp-2">{etf.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
