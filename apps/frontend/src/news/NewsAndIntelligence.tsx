import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';

// --- Types ---

type Severity = 'critical' | 'warning' | 'info';
type Sentiment = 'positive' | 'negative' | 'neutral';
type Impact = 'high' | 'medium' | 'low';

// --- Config ---

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

const impactVariant: Record<Impact, 'destructive' | 'secondary' | 'outline'> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
};

type TriangulationConfidence = 'high' | 'medium' | 'low';

const confidenceConfig: Record<TriangulationConfidence, { label: string; color: string; emoji: string }> = {
  high: { label: 'Alta', color: 'bg-green-600 text-white', emoji: '🟢' },
  medium: { label: 'Media', color: 'bg-yellow-600 text-white', emoji: '🟡' },
  low: { label: 'Baja', color: 'bg-red-600 text-white', emoji: '🔴' },
};

type ConfidenceFilter = 'all' | TriangulationConfidence;

const sentimentBorder: Record<Sentiment, string> = {
  positive: 'border-l-4 border-l-green-500',
  negative: 'border-l-4 border-l-red-500',
  neutral: 'border-l-4 border-l-gray-400',
};

const sentimentBadgeVariant: Record<Sentiment, 'default' | 'destructive' | 'secondary'> = {
  positive: 'default',
  negative: 'destructive',
  neutral: 'secondary',
};

// --- Intelligence components ---

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

// --- News article components ---

function formatTime(time: string) {
  const date = new Date(time);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Hace minutos';
  if (diffHours < 24) return `Hace ${diffHours}h`;
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays}d`;
}

// --- Main Dashboard ---

export function NewsAndIntelligence() {
  const utils = trpc.useUtils();

  const { data: intel, isLoading: intelLoading } = trpc.news.intelligence.useQuery(undefined, {
    refetchInterval: 15 * 60 * 1000,
  });
  const { data: news, isLoading: newsLoading } = trpc.news.getAnalyzed.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });

  const refresh = trpc.news.refreshIntelligence.useMutation({
    onSuccess: () => {
      utils.news.intelligence.invalidate();
      utils.news.getAnalyzed.invalidate();
    },
  });

  const analyzeNews = trpc.analysis.news.useMutation();
  const [analysisResults, setAnalysisResults] = useState<Map<string, string>>(new Map());
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [symbolFilter, setSymbolFilter] = useState('');

  const handleAnalyze = async (id: string, title: string) => {
    const result = await analyzeNews.mutateAsync({ title });
    setAnalysisResults((prev) => new Map(prev).set(id, result.analysis));
  };

  const filteredNews = (news ?? []).filter((item) => {
    // confidence filter (existing)
    if (confidenceFilter !== 'all') {
      const conf = (item as Record<string, unknown>).triangulation as { confidence?: string } | undefined;
      if (conf?.confidence !== confidenceFilter) return false;
    }
    // symbol filter (new)
    if (symbolFilter) {
      const tickers = (item as Record<string, unknown>).relatedTickers as string[] | undefined;
      const titleStr = String((item as Record<string, unknown>).title ?? '');
      const tickerMatch = tickers?.some((t) => t.toUpperCase().includes(symbolFilter));
      const titleMatch = titleStr.toUpperCase().includes(symbolFilter);
      if (!tickerMatch && !titleMatch) return false;
    }
    return true;
  });

  const isLoading = intelLoading && newsLoading;

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground">
        Analizando noticias con IA...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Noticias e Inteligencia</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                {refresh.isPending ? 'Analizando...' : 'Actualizar'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refrescar analisis de noticias y sentimiento de mercado.</TooltipContent>
          </Tooltip>
        </div>
        <span className="text-xs text-muted-foreground">
          {intel?.totalNewsCount ?? 0} noticias analizadas
        </span>
      </div>

      {/* Alerts */}
      {intel && <AlertsBanner alerts={intel.alerts as AlertItem[]} />}

      {/* Plaza cards */}
      {intel && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(intel.plazas as PlazaItem[]).map((plaza: PlazaItem) => (
            <PlazaCard key={plaza.plaza} plaza={plaza} />
          ))}
        </div>
      )}

      {intel && (
        <p className="text-[10px] text-muted-foreground text-right">
          Inteligencia actualizada: {new Date(intel.analyzedAt).toLocaleTimeString('es-AR')}
        </p>
      )}

      {/* Separator */}
      <Separator />

      {/* News feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Noticias recientes</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Buscar símbolo..."
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
              className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-36"
            />
            <div className="flex gap-1">
              {(['all', 'high', 'medium', 'low'] as const).map((filter) => (
                <Button
                  key={filter}
                  size="sm"
                  variant={confidenceFilter === filter ? 'default' : 'ghost'}
                  className="text-[10px] h-6 px-2"
                  onClick={() => setConfidenceFilter(filter)}
                >
                  {filter === 'all' ? 'Todas' : `${confidenceConfig[filter].emoji} ${confidenceConfig[filter].label}`}
                </Button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">{filteredNews.length} articulos</span>
          </div>
        </div>
        <div className="space-y-3">
          {filteredNews.map((item) => {
            const sentiment = item.sentiment as Sentiment;
            const impact = item.impact as Impact;
            const analysis = 'analysis' in item ? (item as Record<string, unknown>).analysis as { summary?: string } | null : null;
            const triangulation = (item as Record<string, unknown>).triangulation as {
              confidence?: TriangulationConfidence;
              sourceCount?: number;
              corroboratedBy?: string[];
            } | undefined;
            const conf = triangulation?.confidence ?? 'low';
            const confCfg = confidenceConfig[conf];

            return (
              <Card key={item.id} size="sm" className={sentimentBorder[sentiment]}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div className="flex gap-3 flex-1 min-w-0">
                    {item.thumbnailUrl && (
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="w-16 h-16 rounded-md object-cover shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge variant={impactVariant[impact]} className="text-[10px]">
                          {impact}
                        </Badge>
                        <Badge variant={sentimentBadgeVariant[sentiment]} className="text-[10px]">
                          {sentimentLabel[sentiment]}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge className={`text-[10px] ${confCfg.color}`}>
                              {confCfg.emoji} {triangulation?.sourceCount ?? 1} fuente{(triangulation?.sourceCount ?? 1) > 1 ? 's' : ''}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs font-medium">Confianza: {confCfg.label}</p>
                            {triangulation?.corroboratedBy && triangulation.corroboratedBy.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Corroborado por: {triangulation.corroboratedBy.join(', ')}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-xs text-muted-foreground">{item.source}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(item.time)}</span>
                      </div>
                      <CardTitle className="text-sm leading-snug">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                          >
                            {item.title}
                          </a>
                        ) : (
                          item.title
                        )}
                      </CardTitle>
                      {analysis?.summary && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {analysis.summary}
                        </p>
                      )}
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {item.relatedTickers.map((t: string) => (
                          <Badge key={t} variant="outline" className="text-[10px] font-mono">
                            {t}
                          </Badge>
                        ))}
                        {item.sectors.map((s: string) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAnalyze(item.id, item.title)}
                    disabled={analyzeNews.isPending}
                    className="shrink-0"
                  >
                    {analyzeNews.isPending ? 'Analizando...' : 'Analizar IA'}
                  </Button>
                </CardHeader>
                {analysisResults.get(item.id) && (
                  <CardContent>
                    <Separator className="mb-3" />
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {analysisResults.get(item.id)}
                    </p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
