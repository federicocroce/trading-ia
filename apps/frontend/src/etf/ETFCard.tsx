import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';

interface EtfEntry {
  id: number;
  symbol: string;
  name: string;
  category: string;
  description: string | null;
}

interface ETFCardProps {
  etf: EtfEntry;
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

export function ETFCard({ etf, onRemove }: ETFCardProps) {
  return (
    <Card className="bg-card border-border hover:border-blue-500/40 transition-colors">
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm text-white">{etf.symbol}</span>
            <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">
              {CATEGORY_LABELS[etf.category] ?? etf.category}
            </Badge>
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(etf.symbol)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-tight">{etf.name}</p>
        {etf.description && (
          <p className="text-[11px] text-muted-foreground/70 leading-tight">{etf.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
