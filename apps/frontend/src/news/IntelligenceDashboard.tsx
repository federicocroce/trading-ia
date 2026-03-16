import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trpc } from '@/shared/trpc';

type Severity = 'critical' | 'warning' | 'info';
type Sentiment = 'positive' | 'negative' | 'neutral';

const sentimentColor: Record<Sentiment, string> = {
  positive: 'text-green-500',
  negative: 'text-red-500',
  neutral: 'text-muted-foreground',
};

const sentimentBg: Record<Sentiment, string> = {
  positive: 'bg-green-500',
  negative: 'bg-red-500',
  neutral: 'bg-muted-foreground',
};

const sentimentLabel: Record<Sentiment, string> = {
  positive: 'Positivo',
  negative: 'Negativo',
  neutral: 'Neutral',
};

const severityStyles: Record<Severity, string> = {
  critical: 'border-l-red-500 bg-red-500/5',
  warning: 'border-l-yellow-500 bg-yellow-500/5',
  info: 'border-l-blue-500 bg-blue-500/5',
};

const severityLabel: Record<Severity, string> = {
  critical: 'Critico',
  warning: 'Alerta',
  info: 'Info',
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round((score + 1) * 50);
  const isPositive = score > 0;
  const barColor = isPositive ? 'bg-green-500' : score < 0 ? 'bg-red-500' : 'bg-muted-foreground';
  const sentiment: Sentiment = score > 0.05 ? 'positive' : score < -0.05 ? 'negative' : 'neutral';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted relative overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-full ${barColor}`}
          style={{
            left: isPositive ? '50%' : `${pct}%`,
            width: `${Math.abs(score) * 50}%`,
          }}
        />
        <div className="absolute top-0 left-1/2 h-full w-px bg-border" />
      </div>
      <span className={`text-xs font-mono ${sentimentColor[sentiment]}`}>
        {score > 0 ? '+' : ''}{score.toFixed(2)}
      </span>
    </div>
  );
}

interface AlertItem {
  type: string;
  severity: Severity;
  symbol?: string;
  plaza: string;
  message: string;
}

function AlertsBanner({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Alertas</h3>
      {alerts.map((alert: AlertItem, i: number) => (
        <div
          key={i}
          className={`rounded-md border-l-4 px-3 py-2 text-sm ${severityStyles[alert.severity]}`}
        >
          <div className="flex items-center gap-2">
            <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'} className="text-[10px]">
              {severityLabel[alert.severity]}
            </Badge>
            {alert.symbol && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {alert.symbol}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm">{alert.message}</p>
        </div>
      ))}
    </div>
  );
}

interface TrendItem {
  symbol: string;
  sentiment: Sentiment;
  sentimentScore: number;
  newsCount: number;
  topHeadlines: string[];
}

function SymbolTrendRow({ trend }: { trend: TrendItem }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Badge variant="outline" className="text-[10px] font-mono w-16 justify-center">
        {trend.symbol}
      </Badge>
      <div className={`h-2 w-2 rounded-full ${sentimentBg[trend.sentiment]}`} />
      <ScoreBar score={trend.sentimentScore} />
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {trend.newsCount} noticias
      </span>
    </div>
  );
}

interface PlazaItem {
  plaza: string;
  label: string;
  overallSentiment: Sentiment;
  sentimentScore: number;
  symbolTrends: TrendItem[];
  keyInsight: string;
}

function PlazaCard({ plaza }: { plaza: PlazaItem }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{plaza.label}</CardTitle>
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${sentimentBg[plaza.overallSentiment]}`} />
            <Badge
              variant={plaza.overallSentiment === 'positive' ? 'default' : plaza.overallSentiment === 'negative' ? 'destructive' : 'secondary'}
              className="text-[10px]"
            >
              {sentimentLabel[plaza.overallSentiment]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScoreBar score={plaza.sentimentScore} />

        {plaza.symbolTrends.length > 0 ? (
          <div className="mt-3 space-y-0.5">
            {plaza.symbolTrends.map((trend: TrendItem) => (
              <SymbolTrendRow key={trend.symbol} trend={trend} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Sin tickers afectados</p>
        )}

        {plaza.symbolTrends.length > 0 && plaza.symbolTrends[0].topHeadlines.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="text-[10px] text-muted-foreground mb-1">Top noticias:</p>
            {plaza.symbolTrends[0].topHeadlines.slice(0, 2).map((headline: string, i: number) => (
              <p key={i} className="text-xs truncate text-muted-foreground">{headline}</p>
            ))}
          </div>
        )}

        <p className="mt-2 text-xs text-muted-foreground italic">{plaza.keyInsight}</p>
      </CardContent>
    </Card>
  );
}

export function IntelligenceDashboard() {
  const utils = trpc.useUtils();
  const { data: intel, isLoading } = trpc.news.intelligence.useQuery(undefined, {
    refetchInterval: 15 * 60 * 1000,
  });
  const refresh = trpc.news.refreshIntelligence.useMutation({
    onSuccess: () => {
      utils.news.intelligence.invalidate();
      utils.news.getAnalyzed.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground">
        Analizando noticias con IA...
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="p-6 text-muted-foreground">
        No hay datos de inteligencia disponibles.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Inteligencia de Mercado</h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? 'Analizando...' : 'Actualizar analisis'}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {intel.totalNewsCount} noticias analizadas
        </span>
      </div>

      <AlertsBanner alerts={intel.alerts as AlertItem[]} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(intel.plazas as PlazaItem[]).map((plaza: PlazaItem) => (
          <PlazaCard key={plaza.plaza} plaza={plaza} />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Actualizado: {new Date(intel.analyzedAt).toLocaleTimeString('es-AR')}
      </p>
    </div>
  );
}
